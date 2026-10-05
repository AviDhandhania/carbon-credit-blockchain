import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function MarketplacePanel({ provider, signer, account, contractAddress, contractABI, creditTokenAddress, creditTokenABI }) {
  const [contract, setContract] = useState(null);
  const [creditToken, setCreditToken] = useState(null);
  const [listings, setListings] = useState([]);
  const [userListings, setUserListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createForm, setCreateForm] = useState({ batchId: '', amount: '', price: '' });
  const [buyForm, setBuyForm] = useState({ listingId: '', amount: '' });

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
      const count = await contract.listingCount();
      const activeListings = [];
      
      for (let i = 1; i <= Number(count); i++) {
        try {
          const listing = await contract.getListing(i);
          if (listing[4]) { // isActive
            const batchInfo = await creditToken.getBatchInfo(listing[0]);
            activeListings.push({
              listingId: i.toString(),
              batchId: listing[0].toString(),
              seller: listing[1],
              amount: ethers.formatUnits(listing[2], 18),
              pricePerToken: ethers.formatEther(listing[3]),
              projectId: batchInfo[0],
              createdAt: new Date(Number(listing[5]) * 1000).toLocaleString()
            });
          }
        } catch (e) {
          // Listing might not exist
        }
      }
      setListings(activeListings);

      // Load user listings
      try {
        const userListingIds = await contract.getUserListings(account);
        const ul = [];
        for (const id of userListingIds) {
          const listing = await contract.getListing(id);
          ul.push({
            listingId: id.toString(),
            batchId: listing[0].toString(),
            amount: ethers.formatUnits(listing[2], 18),
            pricePerToken: ethers.formatEther(listing[3]),
            isActive: listing[4]
          });
        }
        setUserListings(ul);
      } catch (e) {
        // No user listings
      }
    } catch (err) {
      console.error('Error loading marketplace data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateListing = async (e) => {
    e.preventDefault();
    if (!contract || !signer || !creditToken) return;
    setError(null);
    try {
      const amount = ethers.parseUnits(createForm.amount, 18);
      const price = ethers.parseEther(createForm.price);
      
      // First approve
      const approveTx = await creditToken.approve(contractAddress, amount);
      await approveTx.wait();
      
      // Then create listing
      const tx = await contract.createListing(
        createForm.batchId,
        amount,
        price
      );
      await tx.wait();
      loadData();
      setCreateForm({ batchId: '', amount: '', price: '' });
    } catch (err) {
      setError('Create listing failed: ' + err.message);
    }
  };

  const handleBuy = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;
    setError(null);
    try {
      const amount = ethers.parseUnits(buyForm.amount, 18);
      const listing = listings.find(l => l.listingId === buyForm.listingId);
      if (!listing) throw new Error('Listing not found');
      
      // Contract charges (amount * pricePerToken) / 1e18
      const totalPrice = (amount * ethers.parseEther(listing.pricePerToken)) / 10n ** 18n;
      const tx = await contract.buyTokens(buyForm.listingId, amount, { 
        value: totalPrice 
      });
      await tx.wait();
      loadData();
      setBuyForm({ listingId: '', amount: '' });
    } catch (err) {
      setError('Purchase failed: ' + err.message);
    }
  };

  const handleCancel = async (listingId) => {
    if (!contract || !signer) return;
    setError(null);
    try {
      const tx = await contract.cancelListing(listingId);
      await tx.wait();
      loadData();
    } catch (err) {
      setError('Cancel failed: ' + err.message);
    }
  };

  if (!contract) {
    return (
      <div className="card">
        <h2>🏪 Marketplace</h2>
        <div className="status info">Contract not deployed</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>🏪 Marketplace</h2>
      
      {error && <div className="status error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div>
          <h3>Create Listing</h3>
          <form onSubmit={handleCreateListing}>
            <div className="form-group">
              <label>Batch ID</label>
              <input
                type="number"
                value={createForm.batchId}
                onChange={(e) => setCreateForm({...createForm, batchId: e.target.value})}
                placeholder="1"
                required
              />
            </div>
            <div className="form-group">
              <label>Amount (CC)</label>
              <input
                type="number"
                step="0.01"
                value={createForm.amount}
                onChange={(e) => setCreateForm({...createForm, amount: e.target.value})}
                placeholder="100"
                required
              />
            </div>
            <div className="form-group">
              <label>Price per CC (ETH)</label>
              <input
                type="number"
                step="0.00001"
                value={createForm.price}
                onChange={(e) => setCreateForm({...createForm, price: e.target.value})}
                placeholder="0.001"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer}>
              {loading ? 'Creating...' : 'Create Listing'}
            </button>
          </form>
        </div>

        <div>
          <h3>Buy Credits</h3>
          <form onSubmit={handleBuy}>
            <div className="form-group">
              <label>Listing ID</label>
              <select 
                value={buyForm.listingId} 
                onChange={(e) => setBuyForm({...buyForm, listingId: e.target.value})}
                required
              >
                <option value="">Select a listing</option>
                {listings.map(l => (
                  <option key={l.listingId} value={l.listingId}>
                    #{l.listingId} - {l.amount} CC @ {l.pricePerToken} ETH/CC (Batch {l.batchId})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Amount (CC)</label>
              <input
                type="number"
                step="0.01"
                value={buyForm.amount}
                onChange={(e) => setBuyForm({...buyForm, amount: e.target.value})}
                placeholder="50"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !signer || !buyForm.listingId}>
              {loading ? 'Buying...' : 'Buy Credits'}
            </button>
          </form>
        </div>
      </div>

      <h3>Active Listings</h3>
      {loading ? (
        <div className="loading">Loading listings...</div>
      ) : listings.length > 0 ? (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Listing ID</th>
                <th>Batch ID</th>
                <th>Project</th>
                <th>Amount</th>
                <th>Price/CC</th>
                <th>Seller</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.listingId}>
                  <td>#{listing.listingId}</td>
                  <td>{listing.batchId}</td>
                  <td>{listing.projectId}</td>
                  <td>{listing.amount} CC</td>
                  <td>{listing.pricePerToken} ETH</td>
                  <td>{listing.seller.slice(0, 10)}...</td>
                  <td>{listing.createdAt}</td>
                  <td>
                    {listing.seller.toLowerCase() === account.toLowerCase() && (
                      <button 
                        className="btn btn-secondary" 
                        onClick={() => handleCancel(listing.listingId)}
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="status info">No active listings</div>
      )}

      <h3 style={{ marginTop: '2rem' }}>Your Listings</h3>
      {userListings.length > 0 ? (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Listing ID</th>
                <th>Batch ID</th>
                <th>Amount</th>
                <th>Price/CC</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {userListings.map((listing) => (
                <tr key={listing.listingId}>
                  <td>#{listing.listingId}</td>
                  <td>{listing.batchId}</td>
                  <td>{listing.amount} CC</td>
                  <td>{listing.pricePerToken} ETH</td>
                  <td>
                    <span className={`badge ${listing.isActive ? 'badge-active' : 'badge-inactive'}`}>
                      {listing.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="status info">No listings created</div>
      )}
    </div>
  );
}

export default MarketplacePanel;