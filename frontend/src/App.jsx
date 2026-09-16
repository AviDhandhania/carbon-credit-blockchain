import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import WalletConnect from './components/WalletConnect';
import CreditTokenPanel from './components/CreditTokenPanel';
import MarketplacePanel from './components/MarketplacePanel';
import RetireCertifyPanel from './components/RetireCertifyPanel';
import VerifierStakePanel from './components/VerifierStakePanel';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from './utils/contracts';

function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError('MetaMask is not installed. Please install MetaMask to use this application.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await web3Provider.send('eth_requestAccounts', []);
      const network = await web3Provider.getNetwork();
      
      setProvider(web3Provider);
      setSigner(await web3Provider.getSigner());
      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
    } catch (err) {
      setError('Failed to connect wallet: ' + err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setProvider(null);
    setSigner(null);
    setAccount(null);
    setChainId(null);
  };

  const switchNetwork = async (targetChainId) => {
    if (!window.ethereum) return;
    
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
    } catch (err) {
      if (err.code === 4902) {
        // Chain not added, add it
        const chainParams = {
          11155111: {
            chainId: '0xaa36a7',
            chainName: 'Sepolia Testnet',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://eth-sepolia.g.alchemy.com/v2/demo'],
            blockExplorerUrls: ['https://sepolia.etherscan.io/']
          },
          31337: {
            chainId: '0x7a69',
            chainName: 'Localhost Hardhat',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['http://127.0.0.1:8545'],
            blockExplorerUrls: []
          }
        };
        
        if (chainParams[targetChainId]) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [chainParams[targetChainId]]
          });
        }
      }
    }
  };

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          setAccount(accounts[0]);
        }
      });

      window.ethereum.on('chainChanged', (chainId) => {
        setChainId(parseInt(chainId, 16));
        window.location.reload();
      });
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners('accountsChanged');
        window.ethereum.removeAllListeners('chainChanged');
      }
    };
  }, []);

  const isCorrectNetwork = chainId === 11155111 || chainId === 31337;

  return (
    <div className="container">
      <header className="header">
        <h1>🌿 Carbon Credit Trading System</h1>
        <p>Blockchain-based carbon credit marketplace with verifier staking and soulbound certificates</p>
      </header>

      <WalletConnect
        account={account}
        chainId={chainId}
        isConnecting={isConnecting}
        error={error}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
        onSwitchNetwork={switchNetwork}
        isCorrectNetwork={isCorrectNetwork}
      />

      {account && (
        <>
          <CreditTokenPanel
            provider={provider}
            signer={signer}
            account={account}
            contractAddress={CONTRACT_ADDRESSES.CreditToken}
            contractABI={CONTRACT_ABIS.CreditToken}
          />
          
          <div className="section-grid">
            <MarketplacePanel
              provider={provider}
              signer={signer}
              account={account}
              contractAddress={CONTRACT_ADDRESSES.Marketplace}
              contractABI={CONTRACT_ABIS.Marketplace}
              creditTokenAddress={CONTRACT_ADDRESSES.CreditToken}
              creditTokenABI={CONTRACT_ABIS.CreditToken}
            />
            
            <RetireCertifyPanel
              provider={provider}
              signer={signer}
              account={account}
              contractAddress={CONTRACT_ADDRESSES.RetireAndCertify}
              contractABI={CONTRACT_ABIS.RetireAndCertify}
              creditTokenAddress={CONTRACT_ADDRESSES.CreditToken}
              creditTokenABI={CONTRACT_ABIS.CreditToken}
            />
          </div>

          <VerifierStakePanel
            provider={provider}
            signer={signer}
            account={account}
            contractAddress={CONTRACT_ADDRESSES.VerifierStake}
            contractABI={CONTRACT_ABIS.VerifierStake}
            creditTokenAddress={CONTRACT_ADDRESSES.CreditToken}
            creditTokenABI={CONTRACT_ABIS.CreditToken}
          />
        </>
      )}
    </div>
  );
}

export default App;