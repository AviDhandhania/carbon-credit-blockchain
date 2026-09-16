import React from 'react';

function WalletConnect({ 
  account, 
  chainId, 
  isConnecting, 
  error, 
  onConnect, 
  onDisconnect, 
  onSwitchNetwork,
  isCorrectNetwork 
}) {
  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getNetworkName = (id) => {
    switch (id) {
      case 1: return 'Ethereum Mainnet';
      case 11155111: return 'Sepolia Testnet';
      case 31337: return 'Localhost (Hardhat)';
      default: return `Chain ID: ${id}`;
    }
  };

  if (account) {
    return (
      <div className="wallet-info">
        <span>🔗 Connected:</span>
        <span className="wallet-address">{formatAddress(account)}</span>
        <span style={{ 
          padding: '0.25rem 0.75rem', 
          borderRadius: '9999px', 
          fontSize: '0.8rem',
          background: isCorrectNetwork ? '#e8f5e9' : '#fff3e0',
          color: isCorrectNetwork ? '#2e7d32' : '#e65100'
        }}>
          {getNetworkName(chainId)}
        </span>
        {!isCorrectNetwork && (
          <>
            <button
              className="btn btn-secondary"
              onClick={() => onSwitchNetwork(31337)}
              style={{ marginLeft: 'auto' }}
            >
              Switch to Localhost (Hardhat)
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => onSwitchNetwork(11155111)}
            >
              Switch to Sepolia
            </button>
          </>
        )}
        <button className="btn btn-secondary" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: '400px', margin: '0 auto' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Connect Wallet</h2>
      
      {error && <div className="status error">{error}</div>}
      
      <button 
        className="btn btn-primary" 
        onClick={onConnect} 
        disabled={isConnecting}
        style={{ width: '100%', justifyContent: 'center' }}
      >
        {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
      </button>
      
      <p style={{ textAlign: 'center', marginTop: '1rem', color: '#666', fontSize: '0.9rem' }}>
        This application requires MetaMask. <br />
        Supported networks: Sepolia Testnet, Localhost (Hardhat)
      </p>
    </div>
  );
}

export default WalletConnect;