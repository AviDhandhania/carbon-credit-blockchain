import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function VerifierStakePanel({ provider, signer, account, contractAddress, contractABI, creditTokenAddress, creditTokenABI }) {
  const [contract, setContract] = useState(null);
  const [verifierInfo, setVerifierInfo] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [depositForm, setDepositForm] = useState({ amount: '' });
  const [withdrawForm, setWithdrawForm] = useState({ amount: '' });
  const [challengeForm, setChallengeForm] = useState({ batchId: '', evidenceHash: '' });
  const [resolveForm, setResolveForm] = useState({ challengeId: '', result: 'true' });

  useEffect(() => {
    if (provider && contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000') {
      const c = new ethers.Contract(contractAddress, contractABI, signer || provider);
      setContract(c);
      loadData();
    }
  }, [provider, signer, contractAddress]);

  const loadData = async () => {
    if (!contract) return;
    setLoading(true);
    try {
      const [info, challengeCount] = await Promise.all([
        contract.getVerifierInfo(account),
        contract.challengeCount()
      ]);
      
      setVerifierInfo({
        stake: ethers.formatEther(info[0]),
        lastTopUp: new Date(Number(info[1]) * 1000).toLocaleString(),
        isActive: info[2]
      });

      const allChallenges = [];
      for (let i = 1; i <= Number(challengeCount); i++) {
        try {
          const c = await contract.getChallenge(i);
          allChallenges.push({
            id: i.toString(),
            batchId: c[0].toString(),
            challenger: c[1],
            evidenceHash: c[2],
            bond: ethers.formatEther(c[3]),
            timestamp: new Date(Number(c[4]) * 1000).toLocaleString(),
            isResolved: c[5],
            challengerWon: c[6]
          });
        } catch (e) {
          // Challenge might not exist
        }
      }
      setChallenges(allChallenges);
    } catch (err) {
      console.error('Error loading verifier stake data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.depositStake({ 
        value: ethers.parseEther(depositForm.amount) 
      });
      await tx.wait();
      loadData();
      setDepositForm({ amount: '' });
    } catch (err) {
      setError('Deposit failed: ' + err.message);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.withdrawStake(ethers.parseEther(withdrawForm.amount));
      await tx.wait();
      loadData();
      setWithdrawForm({ amount: '' });
    } catch (err) {
      setError('Withdraw failed: ' + err.message);
    }
  };

  const handleChallenge = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.createChallenge(
        challengeForm.batchId,
        challengeForm.evidenceHash,
        { value: ethers.parseEther('0.1') }
      );
      await tx.wait();
      loadData();
      setChallengeForm({ batchId: '', evidenceHash: '' });
    } catch (err) {
      setError('Challenge failed: ' + err.message);
    }
  };

  const handleResolve = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.resolveChallenge(
        resolveForm.challengeId,
        resolveForm.result === 'true'
      );
      await tx.wait();
      loadData();
      setResolveForm({ challengeId: '', result: 'true' });
    } catch (err) {
      setError('Resolve failed: ' + err.message);
    }
  };

  if (!contract) {
    return (
      <div className="card">
        <h2>🛡️ Verifier Stake & Challenge</h2>
        <div className="status info">Contract not deployed</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>🛡️ Verifier Stake & Challenge</h2>
      
      <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div className="status info">
          <strong>Your Stake:</strong> {verifierInfo?.stake || '0'} ETH
        </div>
        <div className="status info">
          <strong>Status:</strong> 
          <span className={`badge ${verifierInfo?.isActive ? 'badge-active' : 'badge-inactive'}`}>
            {verifierInfo?.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="status info">
          <strong>Last Top-up:</strong> {verifierInfo?.lastTopUp || 'Never'}
        </div>
      </div>

      {error && <div className="status error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div>
          <h3>Deposit Stake (Min 1 ETH)</h3>
          <form onSubmit={handleDeposit}>
            <div className="form-group">
              <label>Amount (ETH)</label>
              <input
                type="number"
                step="0.1"
                min="1"
                value={depositForm.amount}
                onChange={(e) => setDepositForm({...depositForm, amount: e.target.value})}
                placeholder="1"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Depositing...' : 'Deposit Stake'}
            </button>
          </form>
        </div>

        <div>
          <h3>Withdraw Stake</h3>
          <form onSubmit={handleWithdraw}>
            <div className="form-group">
              <label>Amount (ETH)</label>
              <input
                type="number"
                step="0.1"
                value={withdrawForm.amount}
                onChange={(e) => setWithdrawForm({...withdrawForm, amount: e.target.value})}
                placeholder="0.5"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Withdrawing...' : 'Withdraw Stake'}
            </button>
          </form>
        </div>

        <div>
          <h3>Create Challenge</h3>
          <form onSubmit={handleChallenge}>
            <div className="form-group">
              <label>Batch ID to Challenge</label>
              <input
                type="number"
                value={challengeForm.batchId}
                onChange={(e) => setChallengeForm({...challengeForm, batchId: e.target.value})}
                placeholder="1"
                required
              />
            </div>
            <div className="form-group">
              <label>Evidence Hash (IPFS)</label>
              <input
                type="text"
                value={challengeForm.evidenceHash}
                onChange={(e) => setChallengeForm({...challengeForm, evidenceHash: e.target.value})}
                placeholder="QmEvidenceHash..."
                required
              />
            </div>
            <div className="form-group">
              <label style={{ fontSize: '0.85rem', color: '#666' }}>
                Challenge bond: 0.1 ETH (returned if challenge fails)
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Challenging...' : 'Create Challenge'}
            </button>
          </form>
        </div>

        <div>
          <h3>Resolve Challenge (Regulator)</h3>
          <form onSubmit={handleResolve}>
            <div className="form-group">
              <label>Challenge ID</label>
              <input
                type="number"
                value={resolveForm.challengeId}
                onChange={(e) => setResolveForm({...resolveForm, challengeId: e.target.value})}
                placeholder="1"
                required
              />
            </div>
            <div className="form-group">
              <label>Result</label>
              <select 
                value={resolveForm.result} 
                onChange={(e) => setResolveForm({...resolveForm, result: e.target.value})}
              >
                <option value="true">Challenger Wins (Slash Verifier)</option>
                <option value="false">Verifier Wins (Keep Stake)</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Resolving...' : 'Resolve Challenge'}
            </button>
          </form>
        </div>
      </div>

      <h3>All Challenges</h3>
      {loading ? (
        <div className="loading">Loading challenges...</div>
      ) : challenges.length > 0 ? (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Challenge ID</th>
                <th>Batch ID</th>
                <th>Challenger</th>
                <th>Evidence Hash</th>
                <th>Bond</th>
                <th>Timestamp</th>
                <th>Status</th>
                <th>Winner</th>
              </tr>
            </thead>
            <tbody>
              {challenges.map((challenge) => (
                <tr key={challenge.id}>
                  <td>#{challenge.id}</td>
                  <td>{challenge.batchId}</td>
                  <td>{challenge.challenger.slice(0, 10)}...</td>
                  <td>{challenge.evidenceHash.slice(0, 20)}...</td>
                  <td>{challenge.bond} ETH</td>
                  <td>{challenge.timestamp}</td>
                  <td>
                    <span className={`badge ${challenge.isResolved ? 'badge-active' : 'badge-pending'}`}>
                      {challenge.isResolved ? 'Resolved' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    {challenge.isResolved ? (
                      <span className={`badge ${challenge.challengerWon ? 'badge-flagged' : 'badge-active'}`}>
                        {challenge.challengerWon ? 'Challenger' : 'Verifier'}
                      </span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="status info">No challenges yet</div>
      )}

      <div className="status info" style={{ marginTop: '1rem' }}>
        <strong>How it works:</strong> Verifiers must stake ≥1 ETH before approving projects. 
        During the 90-day challenge window, anyone can challenge a batch with a 0.1 ETH bond and evidence. 
        If the challenge succeeds, half the verifier's stake is slashed (half to challenger, half to compensation pool). 
        If it fails, the challenger loses their bond.
      </div>
    </div>
  );
}

export default VerifierStakePanel;