import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { diagnostics } from '../utils/diagnostics';

function RetireCertifyPanel({ provider, signer, account, contractAddress, contractABI, creditTokenAddress, creditTokenABI }) {
  const [contract, setContract] = useState(null);
  const [creditToken, setCreditToken] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retireForm, setRetireForm] = useState({ batchId: '', amount: '', metadataURI: '' });
  const [selectedCert, setSelectedCert] = useState(null);

  useEffect(() => {
    if (provider && contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000') {
      const c = new ethers.Contract(contractAddress, contractABI, signer || provider);
      const ct = new ethers.Contract(creditTokenAddress, creditTokenABI, signer || provider);
      setContract(c);
      setCreditToken(ct);
      // Pass the instance: loadData's closure would otherwise still see the
      // previous (null) state on this render, and the first load would no-op.
      loadData(c);
    }
  }, [provider, signer, contractAddress, creditTokenAddress]);

  const loadData = async (instance = contract) => {
    const contract = instance;
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
      diagnostics.contractError('RetireCertifyPanel.loadData', err);
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
      
      // Check allowance first to avoid redundant approval and nonce race
      const allowance = await creditToken.allowance(account, contractAddress);
      if (allowance < amount) {
        const approveTx = await creditToken.approve(contractAddress, amount);
        await approveTx.wait();
        await new Promise((r) => setTimeout(r, 400));
      }
      
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
      diagnostics.txError('retireAndCertify', err);
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
                <th>Certificate Proof</th>
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
                    <button 
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', marginRight: '0.5rem', cursor: 'pointer' }}
                      onClick={() => setSelectedCert(cert)}
                    >
                      📜 Inspect NFT
                    </button>
                    <a 
                      href={cert.metadataURI.replace('ipfs://', '/ipfs/')} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: '#2a9d8f', fontSize: '0.85rem', fontWeight: 'bold' }}
                    >
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

      {/* Certificate Modal */}
      {selectedCert && (
        <div 
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
          }} 
          onClick={() => setSelectedCert(null)}
        >
          <div 
            style={{
              background: '#fff', borderRadius: '14px', padding: '2rem', maxWidth: '520px', width: '92%',
              boxShadow: '0 12px 36px rgba(0,0,0,0.3)', border: '2px solid #2a9d8f'
            }} 
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
              <h3 style={{ margin: 0, color: '#264653' }}>📜 Carbon Offset Certificate #{selectedCert.id}</h3>
              <button 
                type="button"
                className="btn btn-secondary" 
                onClick={() => setSelectedCert(null)} 
                style={{ padding: '0.2rem 0.6rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            
            <div className="status info" style={{ marginBottom: '1rem', background: '#e8f5e9', color: '#2e7d32', borderLeftColor: '#2e7d32' }}>
              🛡️ <strong>Soulbound Proof (Non-Transferable):</strong> Tokens have been burned permanently to guarantee zero double-counting for ESG reporting.
            </div>

            <table style={{ width: '100%', marginBottom: '1.2rem', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
              <tbody>
                <tr><td style={{ padding: '0.35rem 0', fontWeight: 'bold', width: '40%' }}>Certificate ID:</td><td>#{selectedCert.id}</td></tr>
                <tr><td style={{ padding: '0.35rem 0', fontWeight: 'bold' }}>Project Name:</td><td>{selectedCert.projectId}</td></tr>
                <tr><td style={{ padding: '0.35rem 0', fontWeight: 'bold' }}>Batch Lineage:</td><td>Batch #{selectedCert.batchId}</td></tr>
                <tr><td style={{ padding: '0.35rem 0', fontWeight: 'bold' }}>Offset Quantity:</td><td><strong style={{ color: '#2a9d8f' }}>{selectedCert.amountRetired} CC</strong> (tonnes CO₂)</td></tr>
                <tr><td style={{ padding: '0.35rem 0', fontWeight: 'bold' }}>Timestamp:</td><td>{selectedCert.retirementTimestamp}</td></tr>
                <tr><td style={{ padding: '0.35rem 0', fontWeight: 'bold' }}>Beneficiary:</td><td><code style={{ fontSize: '0.8rem' }}>{selectedCert.owner}</code></td></tr>
                <tr><td style={{ padding: '0.35rem 0', fontWeight: 'bold' }}>IPFS CID:</td><td><code style={{ fontSize: '0.8rem' }}>{selectedCert.metadataURI}</code></td></tr>
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <a 
                href={selectedCert.metadataURI.replace('ipfs://', '/ipfs/')}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ textDecoration: 'none', textAlign: 'center', flex: 1, display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}
              >
                Open IPFS JSON Metadata
              </a>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setSelectedCert(null)}
                style={{ cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RetireCertifyPanel;
