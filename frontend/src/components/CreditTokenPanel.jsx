import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function CreditTokenPanel({ provider, signer, account, contractAddress, contractABI }) {
  const [contract, setContract] = useState(null);
  const [batches, setBatches] = useState([]);
  const [totalSupply, setTotalSupply] = useState('0');
  const [userBalance, setUserBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mintForm, setMintForm] = useState({ projectId: '', ipfsHash: '', amount: '' });
  const [retireForm, setRetireForm] = useState({ batchId: '', amount: '' });
  const [splitForm, setSplitForm] = useState({ batchId: '', amount: '', projectId: '' });

  useEffect(() => {
    if (provider && contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000') {
      const c = new ethers.Contract(contractAddress, contractABI, signer || provider);
      setContract(c);
      // Pass the instance: loadData's closure would otherwise still see the
      // previous (null) state on this render, and the first load would no-op.
      loadData(c);
    }
  }, [provider, signer, contractAddress]);

  const loadData = async (instance = contract) => {
    const contract = instance;
    if (!contract) return;
    setLoading(true);
    try {
      const [supply, balance] = await Promise.all([
        contract.totalSupply(),
        contract.balanceOf(account)
      ]);
      setTotalSupply(ethers.formatUnits(supply, 18));
      setUserBalance(ethers.formatUnits(balance, 18));

      // Try to load batches from events
      const filter = contract.filters.BatchMinted();
      // ethers v6 rejects negative block numbers, so scan from genesis
      const events = await contract.queryFilter(filter, 0);
      const batchList = events.map(e => ({
        batchId: e.args.batchId.toString(),
        projectId: e.args.projectId,
        verifier: e.args.verifier,
        ipfsHash: e.args.ipfsHash,
        amount: ethers.formatUnits(e.args.amount, 18),
        timestamp: new Date(Number(e.args.timestamp) * 1000).toLocaleString()
      }));
      setBatches(batchList);
    } catch (err) {
      console.error('Error loading CreditToken data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMint = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.mintBatch(
        mintForm.projectId,
        mintForm.ipfsHash,
        ethers.parseUnits(mintForm.amount, 18)
      );
      await tx.wait();
      loadData();
      setMintForm({ projectId: '', ipfsHash: '', amount: '' });
    } catch (err) {
      setError('Mint failed: ' + err.message);
    }
  };

  const handleRetire = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.retireBatch(
        retireForm.batchId,
        ethers.parseUnits(retireForm.amount, 18)
      );
      await tx.wait();
      loadData();
      setRetireForm({ batchId: '', amount: '' });
    } catch (err) {
      setError('Retire failed: ' + err.message);
    }
  };

  // Fractionalization: regroup part of a batch into a child batch so a project
  // vintage can be traded in granular lots without minting new credits.
  const handleSplit = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.splitBatch(
        splitForm.batchId,
        ethers.parseUnits(splitForm.amount, 18),
        splitForm.projectId
      );
      await tx.wait();
      loadData();
      setSplitForm({ batchId: '', amount: '', projectId: '' });
    } catch (err) {
      setError('Split failed: ' + err.message);
    }
  };

  if (!contract) {
    return (
      <div className="card">
        <h2>🪙 Credit Token (ERC-20)</h2>
        <div className="status info">Contract not deployed. Deploy contracts and update addresses in src/utils/contracts.js</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>🪙 Credit Token (ERC-20)</h2>
      
      <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div className="status info">
          <strong>Total Supply:</strong> {totalSupply} CC
        </div>
        <div className="status info">
          <strong>Your Balance:</strong> {userBalance} CC
        </div>
      </div>

      {error && <div className="status error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div>
          <h3>Mint New Batch (Minter Role Required)</h3>
          <form onSubmit={handleMint}>
            <div className="form-group">
              <label>Project ID</label>
              <input
                type="text"
                value={mintForm.projectId}
                onChange={(e) => setMintForm({...mintForm, projectId: e.target.value})}
                placeholder="PROJ-001"
                required
              />
            </div>
            <div className="form-group">
              <label>IPFS Hash</label>
              <input
                type="text"
                value={mintForm.ipfsHash}
                onChange={(e) => setMintForm({...mintForm, ipfsHash: e.target.value})}
                placeholder="QmHash123..."
                required
              />
            </div>
            <div className="form-group">
              <label>Amount (tonnes CO2)</label>
              <input
                type="number"
                step="0.01"
                value={mintForm.amount}
                onChange={(e) => setMintForm({...mintForm, amount: e.target.value})}
                placeholder="1000"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Processing...' : 'Mint Batch'}
            </button>
          </form>
        </div>

        <div>
          <h3>Retire Credits</h3>
          <form onSubmit={handleRetire}>
            <div className="form-group">
              <label>Batch ID</label>
              <input
                type="number"
                value={retireForm.batchId}
                onChange={(e) => setRetireForm({...retireForm, batchId: e.target.value})}
                placeholder="1"
                required
              />
            </div>
            <div className="form-group">
              <label>Amount (tonnes CO2)</label>
              <input
                type="number"
                step="0.01"
                value={retireForm.amount}
                onChange={(e) => setRetireForm({...retireForm, amount: e.target.value})}
                placeholder="100"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Processing...' : 'Retire Credits'}
            </button>
          </form>
        </div>

        <div>
          <h3>Split Batch (Fractionalize)</h3>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>
            Moves part of a batch into a new child batch that inherits the same verifier
            and evidence. No credits are minted, so total supply is unchanged.
          </p>
          <form onSubmit={handleSplit}>
            <div className="form-group">
              <label>Parent Batch ID</label>
              <input
                type="number"
                value={splitForm.batchId}
                onChange={(e) => setSplitForm({ ...splitForm, batchId: e.target.value })}
                placeholder="1"
                required
              />
            </div>
            <div className="form-group">
              <label>Amount to Split (tonnes CO2)</label>
              <input
                type="number"
                step="0.01"
                value={splitForm.amount}
                onChange={(e) => setSplitForm({ ...splitForm, amount: e.target.value })}
                placeholder="100"
                required
              />
            </div>
            <div className="form-group">
              <label>Child Project ID</label>
              <input
                type="text"
                value={splitForm.projectId}
                onChange={(e) => setSplitForm({ ...splitForm, projectId: e.target.value })}
                placeholder="PROJ-001-A"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Splitting...' : 'Split Batch'}
            </button>
          </form>
        </div>
      </div>

      <h3>Minted Batches</h3>
      {loading ? (
        <div className="loading">Loading batches...</div>
      ) : batches.length > 0 ? (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>Project ID</th>
                <th>Verifier</th>
                <th>IPFS Hash</th>
                <th>Amount</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.batchId}>
                  <td>{batch.batchId}</td>
                  <td>{batch.projectId}</td>
                  <td>{batch.verifier.slice(0, 10)}...</td>
                  <td>{batch.ipfsHash.slice(0, 20)}...</td>
                  <td>{batch.amount} CC</td>
                  <td>{batch.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="status info">No batches minted yet</div>
      )}
    </div>
  );
}

export default CreditTokenPanel;