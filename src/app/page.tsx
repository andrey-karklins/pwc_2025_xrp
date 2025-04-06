"use client";

import { useState, useEffect } from "react";
import { Client, Wallet, xrpToDrops } from "xrpl";

const TRANSFER_AMOUNT = 1; // Amount to transfer (1 XRP)
const TRANSFER_INTERVAL = 5; // Transfer every 5 seconds
const MAX_TRANSACTIONS = 4; // Maximum number of transactions to show
const WALLET1_KEY = 'xrpl_wallet1';
const WALLET2_KEY = 'xrpl_wallet2';

// NFT Icons data
const NFT_ICONS = [
  { id: 1, emoji: "🎮", name: "Game Controller" },
  { id: 2, emoji: "🎨", name: "Art Palette" },
  { id: 3, emoji: "🎵", name: "Musical Note" },
  { id: 4, emoji: "📸", name: "Camera" },
  { id: 5, emoji: "🌟", name: "Star" },
];

interface NFTData {
  id: string;
  tokenId: string;
  icon: string;
  name: string;
  owner: string;
}

interface Transaction {
  id: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  amount: number;
  from: string;
  to: string;
  type: 'xrp' | 'nft';
  nft?: NFTData;
}

interface StoredWallet {
  address: string;
  seed: string;
}

// Helper function to manage wallet creation/retrieval
const getOrCreateWallet = async (client: Client, storageKey: string): Promise<Wallet> => {
  try {
    console.log('🔑 Getting/Creating wallet:', { storageKey });

    const storedWallet = localStorage.getItem(storageKey);
    if (storedWallet) {
      console.log('💾 Found stored wallet:', { storageKey });
      const { seed } = JSON.parse(storedWallet) as StoredWallet;
      const wallet = Wallet.fromSeed(seed);
      
      try {
        const balance = await client.getXrpBalance(wallet.address);
        console.log('💰 Stored wallet balance:', { address: wallet.address, balance });

        if (Number(balance) > 0) {
          return wallet;
        }
      } catch (error) {
        console.warn('⚠️ Stored wallet validation failed:', error);
      }
    }

    console.log('🆕 Creating new wallet:', { storageKey });
    const { wallet } = await client.fundWallet();
    console.log('💸 New wallet funded:', { address: wallet.address });
    
    const walletData: StoredWallet = {
      address: wallet.address,
      seed: wallet.seed!
    };
    localStorage.setItem(storageKey, JSON.stringify(walletData));
    
    return wallet;
  } catch (error) {
    console.error('❌ Wallet creation error:', error);
    throw error;
  }
};

// Helper function to load NFTs for a wallet
const loadWalletNFTs = async (client: Client, address: string): Promise<NFTData[]> => {
  try {
    console.log('📥 Loading NFTs for wallet:', { address });

    const response = await client.request({
      command: "account_nfts",
      account: address
    });

    const nfts = await Promise.all(response.result.account_nfts.map(async (nft) => {
      try {
        // If URI exists, try to decode it
        if (nft.URI) {
          const decoded = Buffer.from(nft.URI, 'hex').toString();
          const metadata = JSON.parse(decoded);
          return {
            id: `nft_${nft.NFTokenID}`,
            tokenId: nft.NFTokenID,
            icon: metadata.icon || '❓',
            name: metadata.name || 'Unknown NFT',
            owner: address
          };
        }
        // Fallback for NFTs without metadata
        return {
          id: `nft_${nft.NFTokenID}`,
          tokenId: nft.NFTokenID,
          icon: '❓',
          name: `NFT #${nft.NFTokenTaxon}`,
          owner: address
        };
      } catch (error) {
        console.warn('⚠️ Error parsing NFT metadata:', error);
        return {
          id: `nft_${nft.NFTokenID}`,
          tokenId: nft.NFTokenID,
          icon: '❓',
          name: `NFT #${nft.NFTokenTaxon}`,
          owner: address
        };
      }
    }));

    console.log('📦 Loaded NFTs:', { address, count: nfts.length, nfts });
    return nfts;
  } catch (error) {
    console.error('❌ Error loading NFTs:', error);
    return [];
  }
};

// Helper function to get NFT offers
const getNFTOffers = async (client: Client, tokenId: string) => {
  try {
    const response = await client.request({
      command: "nft_sell_offers",
      nft_id: tokenId
    });
    return response.result.offers || [];
  } catch (error) {
    console.error('❌ Error getting NFT offers:', error);
    return [];
  }
};

export default function Home() {
  const [isCallActive, setIsCallActive] = useState(false);
  const [time, setTime] = useState(0);
  const [wallet1Balance, setWallet1Balance] = useState<number | null>(null);
  const [wallet2Balance, setWallet2Balance] = useState<number | null>(null);
  const [wallet1, setWallet1] = useState<Wallet | null>(null);
  const [wallet2, setWallet2] = useState<Wallet | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallet1NFTs, setWallet1NFTs] = useState<NFTData[]>([]);
  const [wallet2NFTs, setWallet2NFTs] = useState<NFTData[]>([]);
  const [selectedNFT, setSelectedNFT] = useState<NFTData | null>(null);

  // Initialize XRPL client and wallets
  useEffect(() => {
    const initializeXRPL = async () => {
      try {
        setStatus("Connecting to XRPL testnet...");
        const xrplClient = new Client("wss://s.altnet.rippletest.net:51233");
        await xrplClient.connect();
        setClient(xrplClient);

        setStatus("Initializing wallets...");
        const testWallet1 = await getOrCreateWallet(xrplClient, WALLET1_KEY);
        const testWallet2 = await getOrCreateWallet(xrplClient, WALLET2_KEY);
        
        setWallet1(testWallet1);
        setWallet2(testWallet2);

        await updateBalances(xrplClient, testWallet1, testWallet2);

        // Load existing NFTs for both wallets
        setStatus("Loading NFTs...");
        const [wallet1Nfts, wallet2Nfts] = await Promise.all([
          loadWalletNFTs(xrplClient, testWallet1.address),
          loadWalletNFTs(xrplClient, testWallet2.address)
        ]);

        setWallet1NFTs(wallet1Nfts);
        setWallet2NFTs(wallet2Nfts);
        
        setIsLoading(false);
        setStatus("Ready to start call");
      } catch (error) {
        console.error("XRPL initialization error:", error);
        setStatus("Error initializing XRPL connection");
        setIsLoading(false);
      }
    };

    initializeXRPL();

    return () => {
      if (client) {
        client.disconnect();
      }
    };
  }, []);

  // Function to update wallet balances
  const updateBalances = async (
    xrplClient: Client,
    w1: Wallet,
    w2: Wallet
  ) => {
    try {
      console.log('💰 Updating balances for:', { wallet1: w1.address, wallet2: w2.address });

      const [balance1, balance2] = await Promise.all([
        xrplClient.getXrpBalance(w1.address),
        xrplClient.getXrpBalance(w2.address)
      ]);
      
      console.log('💱 XRP balances:', {
        wallet1: { address: w1.address, balance: balance1 },
        wallet2: { address: w2.address, balance: balance2 }
      });

      setWallet1Balance(Number(balance1));
      setWallet2Balance(Number(balance2));
    } catch (error) {
      console.error('❌ Balance update error:', error);
      setStatus("Error updating balances");
    }
  };

  // Function to mint a new NFT
  const mintNFT = async (icon: { id: number; emoji: string; name: string }) => {
    if (!client || !wallet1) return;

    try {
      console.log('🎨 Minting NFT:', icon);

      const mintTx = {
        TransactionType: "NFTokenMint" as const,
        Account: wallet1.address,
        NFTokenTaxon: icon.id,
        Flags: 8,
        URI: Buffer.from(JSON.stringify({
          name: icon.name,
          icon: icon.emoji
        })).toString('hex').toUpperCase()
      };

      const prepared = await client.autofill(mintTx);
      const signed = wallet1.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      if (result.result.meta && typeof result.result.meta !== 'string') {
        // Reload NFTs to get the new one
        const updatedNFTs = await loadWalletNFTs(client, wallet1.address);
        setWallet1NFTs(updatedNFTs);
        console.log('✅ NFT minted and loaded');
      }
    } catch (error) {
      console.error('❌ NFT minting error:', error);
      setStatus("Error minting NFT");
    }
  };

  // Function to transfer NFT
  const transferNFT = async (nft: NFTData) => {
    if (!client || !wallet1 || !wallet2) return;

    const transactionId = `tx_${Date.now()}`;
    console.log('🔄 Starting NFT transfer:', {
      id: transactionId,
      tokenId: nft.tokenId,
      from: wallet1.address,
      to: wallet2.address
    });

    const newTransaction: Transaction = {
      id: transactionId,
      timestamp: Date.now(),
      status: 'pending',
      amount: 0,
      from: wallet1.address,
      to: wallet2.address,
      type: 'nft',
      nft
    };

    setTransactions(prev => [newTransaction, ...prev].slice(0, MAX_TRANSACTIONS));

    try {
      // Step 1: Create the offer
      console.log('📤 Creating NFT offer...');
      const createOfferTx = {
        TransactionType: "NFTokenCreateOffer" as const,
        Account: wallet1.address,
        NFTokenID: nft.tokenId,
        Destination: wallet2.address,
        Amount: "0",
        Flags: 1
      };

      const preparedOffer = await client.autofill(createOfferTx);
      const signedOffer = wallet1.sign(preparedOffer);
      const offerResult = await client.submitAndWait(signedOffer.tx_blob);

      if (offerResult.result.meta && typeof offerResult.result.meta !== 'string' && 
          offerResult.result.meta.TransactionResult === "tesSUCCESS") {
        
        // Step 2: Get the offer ID
        console.log('🔍 Getting NFT offers...');
        const offers = await getNFTOffers(client, nft.tokenId);
        
        if (offers.length === 0) {
          throw new Error("No offers found for NFT");
        }

        const offer = offers[0];
        console.log('📥 Accepting NFT offer:', offer);

        // Step 3: Accept the offer
        const acceptOfferTx = {
          TransactionType: "NFTokenAcceptOffer" as const,
          Account: wallet2.address,
          NFTokenSellOffer: offer.nft_offer_index
        };

        const preparedAccept = await client.autofill(acceptOfferTx);
        const signedAccept = wallet2.sign(preparedAccept);
        const acceptResult = await client.submitAndWait(signedAccept.tx_blob);

        if (acceptResult.result.meta && typeof acceptResult.result.meta !== 'string' && 
            acceptResult.result.meta.TransactionResult === "tesSUCCESS") {
          
          // Reload NFTs for both wallets
          const [updatedWallet1NFTs, updatedWallet2NFTs] = await Promise.all([
            loadWalletNFTs(client, wallet1.address),
            loadWalletNFTs(client, wallet2.address)
          ]);
          
          setWallet1NFTs(updatedWallet1NFTs);
          setWallet2NFTs(updatedWallet2NFTs);
          
          setTransactions(prev => 
            prev.map(tx => 
              tx.id === transactionId 
                ? { ...tx, status: 'completed' } 
                : tx
            )
          );
          console.log('✅ NFT transfer completed:', { transactionId });
        } else {
          throw new Error("Failed to accept NFT offer");
        }
      } else {
        throw new Error("Failed to create NFT offer");
      }
    } catch (error) {
      console.error('❌ NFT transfer failed:', {
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      setStatus(error instanceof Error ? error.message : "Error transferring NFT");
      setTransactions(prev => 
        prev.map(tx => 
          tx.id === transactionId 
            ? { ...tx, status: 'failed' } 
            : tx
        )
      );
    }
  };

  // Handle XRP transfer
  const transferXRP = async () => {
    if (!client || !wallet1 || !wallet2) return;

    const transactionId = `tx_${Date.now()}`;
    console.log('🔄 Starting transfer:', {
      id: transactionId,
      from: wallet1.address,
      to: wallet2.address,
      amount: TRANSFER_AMOUNT
    });

    const newTransaction: Transaction = {
      id: transactionId,
      timestamp: Date.now(),
      status: 'pending',
      amount: TRANSFER_AMOUNT,
      from: wallet1.address,
      to: wallet2.address,
      type: 'xrp'
    };

    setTransactions(prev => [newTransaction, ...prev].slice(0, MAX_TRANSACTIONS));

    try {
      const payment = {
        TransactionType: "Payment" as const,
        Account: wallet1.address,
        Destination: wallet2.address,
        Amount: xrpToDrops(TRANSFER_AMOUNT)
      };

      console.log('📝 Payment prepared:', payment);

      const prepared = await client.autofill(payment);
      console.log('✍️ Payment autofilled:', prepared);

      const signed = wallet1.sign(prepared);
      console.log('📋 Payment signed:', { hash: signed.hash });

      const result = await client.submitAndWait(signed.tx_blob);
      console.log('📬 Payment result:', result.result);

      if (result.result.meta && typeof result.result.meta !== 'string' && 
          result.result.meta.TransactionResult === "tesSUCCESS") {
        await updateBalances(client, wallet1, wallet2);
        setTransactions(prev => 
          prev.map(tx => 
            tx.id === transactionId 
              ? { ...tx, status: 'completed' } 
              : tx
          )
        );
        console.log('✅ Transfer completed:', { transactionId });
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      console.error('❌ Transfer failed:', {
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      setStatus("Error during transfer");
      setTransactions(prev => 
        prev.map(tx => 
          tx.id === transactionId 
            ? { ...tx, status: 'failed' } 
            : tx
        )
      );
    }
  };

  useEffect(() => {
    let timerInterval: NodeJS.Timeout;
    let transferInterval: NodeJS.Timeout;
    
    if (isCallActive && !isLoading) {
      // Timer update every second
      timerInterval = setInterval(() => {
        setTime((prevTime) => prevTime + 1);
      }, 1000);

      // Transfer XRP every 5 seconds
      transferInterval = setInterval(() => {
        transferXRP();
      }, TRANSFER_INTERVAL * 1000);
    }

    return () => {
      if (timerInterval) clearInterval(timerInterval);
      if (transferInterval) clearInterval(transferInterval);
    };
  }, [isCallActive, isLoading]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleStartCall = () => {
    setIsCallActive(true);
    setStatus("Call active - transferring XRP");
    setTransactions([]); // Clear previous transactions
  };

  const handleEndCall = () => {
    setIsCallActive(false);
    setTime(0);
    setStatus("Call ended");
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  // Function to burn/destroy an NFT
  const burnNFT = async (nft: NFTData) => {
    if (!client || !wallet2) return;

    const transactionId = `tx_${Date.now()}`;
    console.log('🔥 Burning NFT:', {
      id: transactionId,
      tokenId: nft.tokenId,
      owner: wallet2.address
    });

    const newTransaction: Transaction = {
      id: transactionId,
      timestamp: Date.now(),
      status: 'pending',
      amount: 0,
      from: wallet2.address,
      to: 'BURN',
      type: 'nft',
      nft
    };

    setTransactions(prev => [newTransaction, ...prev].slice(0, MAX_TRANSACTIONS));

    try {
      const burnTx = {
        TransactionType: "NFTokenBurn" as const,
        Account: wallet2.address,
        NFTokenID: nft.tokenId
      };

      const prepared = await client.autofill(burnTx);
      const signed = wallet2.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      if (result.result.meta && typeof result.result.meta !== 'string' && 
          result.result.meta.TransactionResult === "tesSUCCESS") {
        
        // Reload NFTs for wallet2
        const updatedWallet2NFTs = await loadWalletNFTs(client, wallet2.address);
        setWallet2NFTs(updatedWallet2NFTs);
        
        setTransactions(prev => 
          prev.map(tx => 
            tx.id === transactionId 
              ? { ...tx, status: 'completed' } 
              : tx
          )
        );
        console.log('✅ NFT burned:', { transactionId });
      } else {
        throw new Error("Failed to burn NFT");
      }
    } catch (error) {
      console.error('❌ NFT burn failed:', {
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      setStatus(error instanceof Error ? error.message : "Error burning NFT");
      setTransactions(prev => 
        prev.map(tx => 
          tx.id === transactionId 
            ? { ...tx, status: 'failed' } 
            : tx
        )
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-gray-600">{status}</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen p-8 bg-gray-50">
      {/* Transaction History */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[600px] bg-white p-4 rounded-lg shadow-md">
        <div className="text-sm font-semibold mb-2">Recent Transactions</div>
        <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-rounded-full scrollbar-track-rounded-full scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          {transactions.map((tx, index) => (
            <div key={tx.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 flex items-center justify-center bg-gray-200 rounded-full text-xs font-medium text-gray-700">
                  {transactions.length - index}
                </span>
                <span className={`w-2 h-2 rounded-full ${
                  tx.status === 'pending' ? 'bg-yellow-500' :
                  tx.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                }`} />
                <span className="font-medium">
                  {formatAddress(tx.from)} → {formatAddress(tx.to)}
                  {tx.type === 'nft' && tx.nft && (
                    <span className="ml-2 text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                      NFT: {tx.nft.icon} {tx.nft.name}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {tx.type === 'xrp' ? (
                  <span className="font-medium">{tx.amount} XRP</span>
                ) : (
                  <span className="font-medium text-purple-600">NFT</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  tx.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {tx.status}
                </span>
              </div>
            </div>
          ))}
          {transactions.length === 0 && (
            <div className="text-center text-gray-500 text-sm py-4">
              No transactions yet
            </div>
          )}
        </div>
      </div>

      {/* Wallet Balances and NFTs */}
      <div className="absolute top-48 left-4 bg-white p-4 rounded-lg shadow-md">
        <div className="text-sm text-gray-600">Wallet 1 Balance</div>
        <div className="text-xl font-bold text-blue-600">
          {wallet1Balance?.toFixed(2)} XRP
        </div>
        <div className="text-xs text-gray-500 mt-1 break-all">
          {wallet1?.address}
        </div>
        <div className="mt-4">
          <div className="text-sm font-semibold text-gray-600 mb-2">Mint New NFTs</div>
          <div className="flex flex-wrap gap-2">
            {NFT_ICONS.map(icon => (
              <button
                key={icon.id}
                onClick={() => mintNFT(icon)}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                title={`Mint ${icon.name} NFT`}
              >
                {icon.emoji}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <div className="text-sm font-semibold text-gray-600 mb-2">Your NFTs (Click to Transfer)</div>
            <div className="flex flex-wrap gap-2">
              {wallet1NFTs.map(nft => (
                <button
                  key={nft.id}
                  onClick={() => transferNFT(nft)}
                  className="w-8 h-8 flex items-center justify-center bg-purple-100 rounded hover:bg-purple-200 transition-colors"
                  title={`Transfer ${nft.name} NFT`}
                >
                  {nft.icon}
                </button>
              ))}
              {wallet1NFTs.length === 0 && (
                <div className="text-sm text-gray-500">No NFTs yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="absolute top-48 right-4 bg-white p-4 rounded-lg shadow-md">
        <div className="text-sm text-gray-600">Wallet 2 Balance</div>
        <div className="text-xl font-bold text-blue-600">
          {wallet2Balance?.toFixed(2)} XRP
        </div>
        <div className="text-xs text-gray-500 mt-1 break-all">
          {wallet2?.address}
        </div>
        <div className="mt-4">
          <div className="text-sm font-semibold text-gray-600 mb-2">Received NFTs (Click to Burn)</div>
          <div className="flex flex-wrap gap-2">
            {wallet2NFTs.map(nft => (
              <button
                key={nft.id}
                onClick={() => burnNFT(nft)}
                className="w-8 h-8 flex items-center justify-center bg-red-100 hover:bg-red-200 rounded transition-colors"
                title={`Burn ${nft.name} NFT`}
              >
                {nft.icon}
              </button>
            ))}
            {wallet2NFTs.length === 0 && (
              <div className="text-sm text-gray-500">No NFTs received</div>
            )}
          </div>
        </div>
      </div>

      {/* Timer and Call Controls */}
      <div className="flex flex-col items-center justify-center min-h-screen gap-8">
        <div className="text-6xl font-mono font-bold">
          {formatTime(time)}
        </div>
        
        <div className="flex gap-4">
          <button
            onClick={handleStartCall}
            disabled={isCallActive || isLoading}
            className={`px-6 py-3 rounded-lg font-semibold text-white ${
              isCallActive || isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            Start Call
          </button>
          
          <button
            onClick={handleEndCall}
            disabled={!isCallActive || isLoading}
            className={`px-6 py-3 rounded-lg font-semibold text-white ${
              !isCallActive || isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            End Call
          </button>
        </div>

        <div className={`text-sm ${isCallActive ? 'text-green-600' : 'text-gray-600'} ${isCallActive ? 'animate-pulse' : ''}`}>
          {status}
        </div>
      </div>
    </div>
  );
}
