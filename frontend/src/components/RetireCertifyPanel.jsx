import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function RetireCertifyPanel({ provider, signer, account, contractAddress, contractABI, creditTokenAddress, creditTokenABI }) {
  const [contract, setContract] = useState(null);
  const [creditToken, setCreditToken] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retireForm, setRetireForm] = useState({ batchId: '', amount: '', metadataURI: '' });

  useEffect(() => {
    if (provider && contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000') {
      const c = new ethers.Contract(contractAddress, contractABI, signer || provider);
      const ct = new ethers.Contract(creditTokenAddress, creditTokenABI, signer || provider);
      setContract(c);
      setCreditToken(ct);
      loadData();
    }
  }, [provider, signer, contractAddress, creditTokenAddress]);

  const loadData = async () => {
    if (!contract) return;
    setLoading(true);
    try {
      const certIds = await contract.getUserCertificates(account);
      const certList = [];
      for (const id of certIds) {
        const cert = await contract.getCertificate(id);
        certList.push({
          id: id.toString(),
          owner: cert[0],
          batchId: cert[1].toString(),
          amountRetired: ethers.formatUnits(cert[2], 18),
          projectId: cert[3],
          retirementTimestamp: new Date(Number(cert[4]) * 1000).toLocaleString(),
          metadataURI: cert[5]
        });
      }
      setCertificates(certList);
    } catch (err) {
      console.error('Error loading certificates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRetireAndCertify = async (e) => {
    e.preventDefault();
    if (!contract || !signer || !creditToken) return;
    setError(null);
    try {
      const amount = ethers.parseUnits(retireForm.amount, 18);
      
      // First approve the contract to spend tokens
      const approveTx = await creditToken.approve(contractAddress, amount);
      await approveTx.wait();
      
      // Then retire and certify
      const tx = await contract.retireAndCertify(
        retireForm.batchId,
        amount,
        retireForm.metadataURI
      );
      await tx.wait();
      loadData();
      setRetireForm({ batchId: '', amount: '', metadataURI: '' });
    } catch (err) {
      setError('Retire & Certify failed: ' + err.message);
    }
  };

  if (!contract) {
    return (
      <div className="card">
        <h2>📜 Retire & Certify</h2>
        <div className="status info">Contract not deployed</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>📜 Retire & Certify (Soulbound NFT)</h2>
      
      {error && <div className="status error">{error}</div>}

      <div>
        <h3>Retire Credits & Mint Certificate</h3>
        <form onSubmit={handleRetireAndCertify}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
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
              <label>Amount (CC)</label>
              <input
                type="number"
                step="0.01"
                value={retireForm.amount}
                onChange={(e) => setRetireForm({...retireForm, amount: e.target.value})}
                placeholder="100"
                required
              />
            </div>
            <div className="form-group">
              <label>Metadata URI (IPFS)</label>
              <input
                type="text"
                value={retireForm.metadataURI}
                onChange={(e) => setRetireForm({...retireForm, metadataURI: e.target.value})}
                placeholder="ipfs://QmCertificateHash"
                required
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading || !signer} style={{ marginTop: '1rem' }}>
            {loading ? 'Processing...' : 'Retire & Mint Certificate'}
          </button>
        </form>
      </div>

      <h3 style={{ marginTop: '2rem' }}>Your Retirement Certificates (Soulbound)</h3>
      {loading ? (
        <div className="loading">Loading certificates...</div>
      ) : certificates.length > 0 ? (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Cert ID</th>
                <th>Batch ID</th>
                <th>Project</th>
                <th>Amount Retired</th>
                <th>Retirement Date</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((cert) => (
                <tr key={cert.id}>
                  <td>#{cert.id}</td>
                  <td>{cert.batchId}</td>
                  <td>{cert.projectId}</td>
                  <td>{cert.amountRetired} CC</td>
                  <td>{cert.retirementTimestamp}</td>
                  <td>
                    <a href={cert.metadataURI.replace('ipfs://', 'https://ipfs.io/ipfs/')} 
                       target="_blank" rel="noopener noreferrer"
                       style={{ color: '#2a9d8f' }}>
                      View on IPFS
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="status info">No retirement certificates yet. Retire credits to mint soulbound certificates.</div>
      )}

      <div className="status info" style={{ marginTop: '1rem' }}>
        <strong>Note:</strong> Certificates are soulbound (non-transferable) ERC-721 tokens. 
        They cannot be transferred, approved, or sold. They serve as permanent proof of carbon offset retirement.
      </div>
    </div>
  );
}

export default RetireCertifyPanel;