import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function RegulatorMultisigPanel({ provider, signer, account, contractAddress, contractABI }) {
  const [contract, setContract] = useState(null);
  const [panel, setPanel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [proposeForm, setProposeForm] = useState({ challengeId: '', result: 'true' });
  const [actionForm, setActionForm] = useState({ challengeId: '' });
  const [proposal, setProposal] = useState(null);

  useEffect(() => {
    if (provider && contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000') {
      const c = new ethers.Contract(contractAddress, contractABI, signer || provider);
      setContract(c);
      loadData(c);
    }
  }, [provider, signer, contractAddress]);

  const loadData = async (c = contract) => {
    if (!c) return;
    setLoading(true);
    try {
      const [threshold, ownerList, stakeAddr] = await Promise.all([
        c.threshold(),
        c.owners(),
        c.verifierStake()
      ]);

      setPanel({
        threshold: Number(threshold),
        owners: ownerList,
        verifierStake: stakeAddr,
        isOwner: account ? await c.isOwner(account) : false
      });
    } catch (err) {
      console.error('Error loading multisig data:', err);
      setError('Failed to read the regulator panel: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadProposal = async (challengeId) => {
    if (!contract || challengeId === '' || challengeId === null) return;
    try {
      const p = await contract.proposals(challengeId);
      const approvedByMe = account ? await contract.approved(challengeId, account) : false;
      setProposal({
        challengeId: p[0].toString(),
        challengerWins: p[1],
        approvals: Number(p[2]),
        executed: p[3],
        exists: p[4],
        approvedByMe
      });
    } catch (err) {
      setProposal(null);
    }
  };

  const runAction = async (label, fn) => {
    if (!contract || !signer) return;
    setError(null);
    setLoading(true);
    try {
      const tx = await fn();
      await tx.wait();
      await loadData();
      if (actionForm.challengeId) await loadProposal(actionForm.challengeId);
      if (proposeForm.challengeId) await loadProposal(proposeForm.challengeId);
    } catch (err) {
      setError(`${label} failed: ` + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePropose = (e) => {
    e.preventDefault();
    runAction('Propose', () =>
      contract.proposeResolution(proposeForm.challengeId, proposeForm.result === 'true')
    );
  };

  const handleApprove = (challengeId) => {
    runAction('Approve', () => contract.approveResolution(challengeId));
  };

  const handleExecute = (challengeId) => {
    runAction('Execute', () => contract.executeResolution(challengeId));
  };

  if (!contract) {
    return (
      <div className="card">
        <h2>🏛️ Regulator Multisig (3-of-5)</h2>
        <div className="status info">Contract not deployed</div>
      </div>
    );
  }

  const approvalsNeeded = panel && !proposal
    ? panel.threshold
    : panel && proposal
      ? Math.max(panel.threshold - proposal.approvals, 0)
      : null;

  return (
    <div className="card">
      <h2>🏛️ Regulator Multisig (3-of-5)</h2>

      <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div className="status info">
          <strong>Threshold:</strong> {panel ? `${panel.threshold}-of-${panel.owners.length}` : '-'}
        </div>
        <div className="status info">
          <strong>Your account:</strong>{' '}
          {panel?.isOwner
            ? <span className="badge badge-active">Panel owner</span>
            : <span className="badge badge-inactive">Not an owner</span>}
        </div>
      </div>

      {error && <div className="status error">{error}</div>}

      {panel && (
        <div className="status info" style={{ marginBottom: '1.5rem', display: 'block' }}>
          <div><strong>Governs:</strong> VerifierStake at {panel.verifierStake}</div>
          <div style={{ marginTop: '0.5rem' }}>
            <strong>Owners:</strong>
            <ul style={{ margin: '0.25rem 0 0 1rem' }}>
              {panel.owners.map((owner) => (
                <li key={owner} style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {owner}
                  {account && owner.toLowerCase() === account.toLowerCase() ? ' (you)' : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div>
          <h3>Propose Resolution</h3>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>
            A challenge can only be proposed once; the outcome is bound to the approvals.
          </p>
          <form onSubmit={handlePropose}>
            <div className="form-group">
              <label>Challenge ID</label>
              <input
                type="number"
                value={proposeForm.challengeId}
                onChange={(e) => {
                  setProposeForm({ ...proposeForm, challengeId: e.target.value });
                  loadProposal(e.target.value);
                }}
                placeholder="1"
                required
              />
            </div>
            <div className="form-group">
              <label>Outcome</label>
              <select
                value={proposeForm.result}
                onChange={(e) => setProposeForm({ ...proposeForm, result: e.target.value })}
              >
                <option value="true">Challenger Wins (Slash Verifier)</option>
                <option value="false">Verifier Wins (Keep Stake)</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Working...' : 'Propose Resolution'}
            </button>
          </form>
        </div>

        <div>
          <h3>Approve / Execute</h3>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>
            The resolution executes automatically once the threshold is reached.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); loadProposal(actionForm.challengeId); }}>
            <div className="form-group">
              <label>Challenge ID</label>
              <input
                type="number"
                value={actionForm.challengeId}
                onChange={(e) => {
                  setActionForm({ challengeId: e.target.value });
                  loadProposal(e.target.value);
                }}
                placeholder="1"
                required
              />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={loading}>
              Load Proposal
            </button>
          </form>

          {proposal && (
            <div className="status info" style={{ marginTop: '1rem', display: 'block' }}>
              {!proposal.exists ? (
                <div>No proposal exists for challenge #{proposal.challengeId}.</div>
              ) : (
                <>
                  <div><strong>Approvals:</strong> {proposal.approvals} / {panel?.threshold}</div>
                  <div><strong>Outcome:</strong> {proposal.challengerWins ? 'Challenger wins' : 'Verifier wins'}</div>
                  <div>
                    <strong>Status:</strong>{' '}
                    <span className={`badge ${proposal.executed ? 'badge-active' : 'badge-pending'}`}>
                      {proposal.executed ? 'Executed' : 'Pending'}
                    </span>
                  </div>
                  {!proposal.executed && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleApprove(proposal.challengeId)}
                        disabled={loading || !signer || proposal.approvedByMe}
                      >
                        {proposal.approvedByMe ? 'Already Approved' : `Approve (${approvalsNeeded} more needed)`}
                      </button>
                      {approvalsNeeded === 0 && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleExecute(proposal.challengeId)}
                          disabled={loading || !signer}
                        >
                          Execute
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="status info">
        <strong>How it works:</strong> The panel holds REGULATOR_ROLE on VerifierStake and the deployer's
        single-key regulator power is revoked at deploy time. A resolution must be proposed once and approved
        by {panel?.threshold ?? 3} distinct owners before it reaches VerifierStake, so no single key can slash
        a verifier or wave a fraudulent batch through.
      </div>
    </div>
  );
}

export default RegulatorMultisigPanel;
