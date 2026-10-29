import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mock-ipfs-gateway',
      configureServer(server) {
        server.middlewares.use('/ipfs', (req, res) => {
          const cid = req.url.replace(/^\//, '').split('?')[0];
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({
            name: "Verified Carbon Retirement Certificate",
            description: "Cryptographic proof of permanent carbon credit offset on Ethereum blockchain",
            ipfsHash: cid || "QmRetireProofCertificate",
            standard: "ERC-721 Soulbound (RTC)",
            transferable: false,
            retirementType: "Permanent Offset (Zero Double-Count)",
            verificationAuthority: "Decentralized Third-Party Verifier Panel",
            issuedAt: new Date().toISOString()
          }, null, 2));
        });
      }
    }
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8545',
        changeOrigin: true
      }
    }
  }
})
