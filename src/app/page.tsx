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

interface StoredWallet {
  address: string;
  seed: string;
}

// Add new interface for logs
interface LogMessage {
  id: string;
  message: string;
  timestamp: number;
}

interface PaymentChannelResponse {
  result: {
    signature?: string;
    signature_verified?: boolean;
    status: string;
  }
}

interface PaymentChannelMeta {
  AffectedNodes: Array<{
    CreatedNode?: {
      LedgerEntryType: string;
      LedgerIndex: string;
    }
  }>;
}

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
  const [wallet1NFTs, setWallet1NFTs] = useState<NFTData[]>([]);
  const [wallet2NFTs, setWallet2NFTs] = useState<NFTData[]>([]);
  const [selectedNFT, setSelectedNFT] = useState<NFTData | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [totalTransferred, setTotalTransferred] = useState(0);
  const [lastAuthorizedAmount, setLastAuthorizedAmount] = useState(0);
  const [logs, setLogs] = useState<LogMessage[]>([]);

  // Add log helper function
  const addLog = (message: string) => {
    setLogs(prev => [
      {
        id: `log_${Date.now()}`,
        message,
        timestamp: Date.now()
      },
      ...prev
    ].slice(0, 50)); // Keep last 50 logs
  };

  // Helper function to manage wallet creation/retrieval
  const getOrCreateWallet = async (client: Client, storageKey: string): Promise<Wallet> => {
    try {
      addLog('🔑 Getting/Creating wallet');

      const storedWallet = localStorage.getItem(storageKey);
      if (storedWallet) {
        try {
          addLog('💾 Found stored wallet');
          const { seed } = JSON.parse(storedWallet) as StoredWallet;
          const wallet = Wallet.fromSeed(seed);
          
          const balance = await client.getXrpBalance(wallet.address);
          addLog('💰 Stored wallet balance verified');

          if (Number(balance) > 0) {
            return wallet;
          }
          
          addLog('⚠️ Stored wallet has no balance, creating new one');
          localStorage.removeItem(storageKey);
        } catch (error) {
          addLog('⚠️ Stored wallet validation failed, creating new one');
          localStorage.removeItem(storageKey);
        }
      }

      addLog('🆕 Creating new wallet');
      const { wallet } = await client.fundWallet();
      addLog('💸 New wallet funded');
      
      const walletData: StoredWallet = {
        address: wallet.address,
        seed: wallet.seed!
      };
      localStorage.setItem(storageKey, JSON.stringify(walletData));
      
      return wallet;
    } catch (error) {
      addLog('❌ Wallet creation error');
      throw error;
    }
  };

  // Helper function to load NFTs for a wallet
  const loadWalletNFTs = async (client: Client, address: string): Promise<NFTData[]> => {
    try {
      addLog('📥 Loading NFTs for wallet');

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
          addLog('⚠️ Error parsing NFT metadata');
          return {
            id: `nft_${nft.NFTokenID}`,
            tokenId: nft.NFTokenID,
            icon: '❓',
            name: `NFT #${nft.NFTokenTaxon}`,
            owner: address
          };
        }
      }));

      addLog('📦 Loaded NFTs');
      return nfts;
    } catch (error) {
      addLog('❌ Error loading NFTs');
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
      addLog('❌ Error getting NFT offers');
      return [];
    }
  };

  // Reset wallet function
  const resetWallet = async (storageKey: string) => {
    if (!client) return;
    
    try {
      addLog('🔥 Resetting wallet');
      localStorage.removeItem(storageKey);
      
      const { wallet } = await client.fundWallet();
      addLog('💸 New wallet funded');
      
      const walletData: StoredWallet = {
        address: wallet.address,
        seed: wallet.seed!
      };
      localStorage.setItem(storageKey, JSON.stringify(walletData));
      
      if (storageKey === WALLET1_KEY) {
        setWallet1(wallet);
        const updatedNFTs = await loadWalletNFTs(client, wallet.address);
        setWallet1NFTs(updatedNFTs);
      } else {
        setWallet2(wallet);
        const updatedNFTs = await loadWalletNFTs(client, wallet.address);
        setWallet2NFTs(updatedNFTs);
      }
      
      // Update balances with the correct wallet references
      const w1 = storageKey === WALLET1_KEY ? wallet : wallet1;
      const w2 = storageKey === WALLET2_KEY ? wallet : wallet2;
      if (w1 && w2) {
        await updateBalances(client, w1, w2);
      }
      
      addLog('✅ Wallet reset complete');
    } catch (error) {
      addLog('❌ Wallet reset error');
      setStatus("Error resetting wallet");
    }
  };

  // Initialize XRPL client and wallets
  useEffect(() => {
    let isSubscribed = true; // For cleanup
    
    const initializeXRPL = async () => {
      try {
        if (!isSubscribed) return;
        setIsLoading(true);
        setStatus("Connecting to XRPL testnet...");
        
        const xrplClient = new Client("wss://s.altnet.rippletest.net:51233");
        await xrplClient.connect();
        if (!isSubscribed) return;
        setClient(xrplClient);
        addLog('🌐 Connected to XRPL testnet');

        setStatus("Initializing wallets...");
        let testWallet1, testWallet2;
        try {
          testWallet1 = await getOrCreateWallet(xrplClient, WALLET1_KEY);
          if (!isSubscribed) return;
          setWallet1(testWallet1);
          addLog('👛 Wallet 1 initialized');
        } catch (err) {
          const error = err as Error;
          addLog(`❌ Error initializing wallet 1: ${error.message}`);
          throw error;
        }

        try {
          testWallet2 = await getOrCreateWallet(xrplClient, WALLET2_KEY);
          if (!isSubscribed) return;
          setWallet2(testWallet2);
          addLog('👛 Wallet 2 initialized');
        } catch (err) {
          const error = err as Error;
          addLog(`❌ Error initializing wallet 2: ${error.message}`);
          throw error;
        }

        try {
          await updateBalances(xrplClient, testWallet1, testWallet2);
          if (!isSubscribed) return;
          addLog('💰 Initial balances loaded');
        } catch (err) {
          const error = err as Error;
          addLog(`❌ Error loading initial balances: ${error.message}`);
          throw error;
        }

        // Load existing NFTs for both wallets
        setStatus("Loading NFTs...");
        try {
          const [wallet1Nfts, wallet2Nfts] = await Promise.all([
            loadWalletNFTs(xrplClient, testWallet1.address),
            loadWalletNFTs(xrplClient, testWallet2.address)
          ]);
          
          if (!isSubscribed) return;
          setWallet1NFTs(wallet1Nfts);
          setWallet2NFTs(wallet2Nfts);
          addLog('🎨 NFTs loaded');
        } catch (err) {
          const error = err as Error;
          addLog(`❌ Error loading NFTs: ${error.message}`);
          throw error;
        }
        
        if (!isSubscribed) return;
        setIsLoading(false);
        setStatus("Ready to start call");
      } catch (err) {
        if (!isSubscribed) return;
        const error = err as Error;
        console.error('Initialization error:', error);
        addLog(`❌ XRPL initialization error: ${error.message}`);
        setStatus("Error initializing XRPL connection. Please refresh the page.");
        setIsLoading(false);
        
        // Clean up any partial state
        setWallet1(null);
        setWallet2(null);
        setWallet1NFTs([]);
        setWallet2NFTs([]);
        setWallet1Balance(null);
        setWallet2Balance(null);
      }
    };

    initializeXRPL();

    return () => {
      isSubscribed = false;
      if (client) {
        client.disconnect();
        addLog('🔌 Disconnected from XRPL');
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
      addLog('💰 Updating balances');

      const [balance1, balance2] = await Promise.all([
        xrplClient.getXrpBalance(w1.address),
        xrplClient.getXrpBalance(w2.address)
      ]);

      setWallet1Balance(Number(balance1));
      setWallet2Balance(Number(balance2));
      addLog('💱 Balances updated');
    } catch (error) {
      addLog('❌ Balance update error');
      setStatus("Error updating balances");
    }
  };

  // Function to mint a new NFT
  const mintNFT = async (icon: { id: number; emoji: string; name: string }) => {
    if (!client || !wallet1) return;

    try {
      addLog('🎨 Minting NFT');

      const mintTx = {
        TransactionType: "NFTokenMint" as const,
        Account: wallet1.address,
        NFTokenTaxon: icon.id,
        Flags: 1,
        URI: Buffer.from(JSON.stringify({
          name: icon.name,
          icon: icon.emoji,
          soulbound: true
        })).toString('hex').toUpperCase()
      };

      const prepared = await client.autofill(mintTx);
      const signed = wallet1.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      if (result.result.meta && typeof result.result.meta !== 'string') {
        const updatedNFTs = await loadWalletNFTs(client, wallet1.address);
        setWallet1NFTs(updatedNFTs);
        addLog('✅ NFT minted and loaded');
      }
    } catch (error) {
      addLog('❌ NFT minting error');
      setStatus("Error minting NFT");
    }
  };

  // Function to transfer NFT
  const transferNFT = async (nft: NFTData) => {
    if (!client || !wallet1 || !wallet2) return;

    addLog('🔄 Starting NFT transfer');

    try {
      addLog('📤 Creating NFT offer');
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
        
        addLog('🔍 Getting NFT offers');
        const offers = await getNFTOffers(client, nft.tokenId);
        
        if (offers.length === 0) {
          throw new Error("No offers found for NFT");
        }

        const offer = offers[0];
        addLog('📥 Accepting NFT offer');

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
          
          const [updatedWallet1NFTs, updatedWallet2NFTs] = await Promise.all([
            loadWalletNFTs(client, wallet1.address),
            loadWalletNFTs(client, wallet2.address)
          ]);
          
          setWallet1NFTs(updatedWallet1NFTs);
          setWallet2NFTs(updatedWallet2NFTs);
          
          addLog('✅ NFT transfer completed');
        } else {
          throw new Error("Failed to accept NFT offer");
        }
      } else {
        throw new Error("Failed to create NFT offer");
      }
    } catch (error) {
      addLog('❌ NFT transfer failed');
      setStatus(error instanceof Error ? error.message : "Error transferring NFT");
    }
  };

  // Function to create a payment channel
  const createPaymentChannel = async () => {
    if (!client || !wallet1 || !wallet2) return;
    
    try {
      addLog('🔄 Creating payment channel');
      
      const channelTx = {
        TransactionType: "PaymentChannelCreate" as const,
        Account: wallet1.address,
        Amount: xrpToDrops(10), // Changed from 100 to 10 XRP
        Destination: wallet2.address,
        SettleDelay: 0,
        PublicKey: wallet1.publicKey,
      };

      const prepared = await client.autofill(channelTx);
      console.log('Payment Channel Create - Prepared TX:', prepared);
      
      const signed = wallet1.sign(prepared);
      console.log('Payment Channel Create - Signed TX Hash:', signed.hash);
      
      const result = await client.submitAndWait(signed.tx_blob);
      console.log('Payment Channel Create - Server Response:', result.result);

      if (result.result.meta && typeof result.result.meta !== 'string') {
        const meta = result.result.meta as unknown as PaymentChannelMeta;
        const node = meta.AffectedNodes.find(node => 
          node.CreatedNode?.LedgerEntryType === "PayChannel"
        );
        
        if (node?.CreatedNode) {
          const newChannelId = node.CreatedNode.LedgerIndex;
          setChannelId(newChannelId);
          addLog(`✅ Payment channel created with 10 XRP reserve`);
          return newChannelId;
        }
      }
      throw new Error("Failed to create payment channel");
    } catch (error) {
      addLog('❌ Payment channel creation failed');
      if (error instanceof Error) {
        console.error('Payment Channel Create - Error:', error);
      }
      setStatus("Error creating payment channel");
      return null;
    }
  };

  // Function to authorize a claim on the payment channel
  const authorizePaymentChannelClaim = async (amount: number) => {
    if (!client || !wallet1 || !channelId) return null;
    
    try {
      addLog('🔐 Authorizing payment channel claim');
      console.log('Payment Channel Authorize - Request:', {
        channel_id: channelId,
        amount: xrpToDrops(amount)
      });
      
      const response = await client.request({
        command: "channel_authorize" as any,
        channel_id: channelId,
        amount: xrpToDrops(amount),
        secret: wallet1.seed!
      }) as PaymentChannelResponse;

      console.log('Payment Channel Authorize - Response:', response.result);

      if (response.result?.signature) {
        addLog('✅ Claim authorized');
        return {
          signature: response.result.signature,
          amount: xrpToDrops(amount)
        };
      }
      throw new Error("Failed to authorize claim");
    } catch (error) {
      addLog('❌ Claim authorization failed');
      if (error instanceof Error) {
        console.error('Payment Channel Authorize - Error:', error);
      }
      return null;
    }
  };

  // Function to verify a payment channel claim
  const verifyPaymentChannelClaim = async (signature: string, amount: string) => {
    if (!client || !wallet1 || !channelId) return false;
    
    try {
      addLog('🔍 Verifying payment channel claim');
      console.log('Payment Channel Verify - Request:', {
        channel_id: channelId,
        amount,
        signature: signature.slice(0, 32) + '...'
      });
      
      const response = await client.request({
        command: "channel_verify" as any,
        channel_id: channelId,
        signature: signature,
        public_key: wallet1.publicKey,
        amount: amount
      }) as PaymentChannelResponse;

      console.log('Payment Channel Verify - Response:', response.result);

      if (response.result?.signature_verified) {
        addLog('✅ Claim verified');
        return true;
      }
      addLog('⚠️ Claim verification failed');
      return false;
    } catch (error) {
      addLog('❌ Claim verification failed');
      if (error instanceof Error) {
        console.error('Payment Channel Verify - Error:', error);
      }
      return false;
    }
  };

  // Function to claim XRP from the payment channel
  const claimPaymentChannel = async (signature: string, amount: string) => {
    if (!client || !wallet2 || !channelId) return;
    
    try {
      addLog('💰 Claiming from payment channel');
      
      const claimTx = {
        TransactionType: "PaymentChannelClaim" as const,
        Account: wallet2.address,
        Channel: channelId,
        Amount: amount,
        Balance: amount,
        Signature: signature,
        PublicKey: wallet1?.publicKey
      };

      const prepared = await client.autofill(claimTx);
      console.log('Payment Channel Claim - Prepared TX:', prepared);
      
      const signed = wallet2.sign(prepared);
      console.log('Payment Channel Claim - Signed TX Hash:', signed.hash);
      
      const result = await client.submitAndWait(signed.tx_blob);
      console.log('Payment Channel Claim - Server Response:', result.result);

      if (result.result.meta && typeof result.result.meta !== 'string' && 
          result.result.meta.TransactionResult === "tesSUCCESS") {
        await updateBalances(client, wallet1!, wallet2);
        addLog('✅ Payment channel claim successful');
        return true;
      }
      return false;
    } catch (error) {
      addLog('❌ Payment channel claim failed');
      if (error instanceof Error) {
        console.error('Payment Channel Claim - Error:', error);
      }
      return false;
    }
  };

  // Function to close the payment channel
  const closePaymentChannel = async () => {
    if (!client || !wallet1 || !channelId) return;
    
    try {
      addLog('🔒 Closing payment channel');
      
      const closeTx = {
        TransactionType: "PaymentChannelClaim" as const,
        Account: wallet1.address,
        Channel: channelId,
        Flags: {
          tfClose: true,
          tfRenew: false
        }, // tfClose flag
        Amount: "0" // Required for TypeScript
      };

      const prepared = await client.autofill(closeTx);
      console.log('Payment Channel Close - Prepared TX:', prepared);
      
      const signed = wallet1.sign(prepared);
      console.log('Payment Channel Close - Signed TX Hash:', signed.hash);
      
      const result = await client.submitAndWait(signed.tx_blob);
      console.log('Payment Channel Close - Server Response:', result.result);

      if (result.result.meta && typeof result.result.meta !== 'string' && 
          result.result.meta.TransactionResult === "tesSUCCESS") {
        setChannelId(null);
        setTotalTransferred(0);
        addLog('✅ Payment channel closed');
        return true;
      }
      return false;
    } catch (error) {
      addLog('❌ Payment channel close failed');
      if (error instanceof Error) {
        console.error('Payment Channel Close - Error:', error);
      }
      return false;
    }
  };

  // Modified transferXRP to keep growing the claim amount
  const transferXRP = async () => {
    if (!client || !wallet1 || !wallet2 || !channelId || !isCallActive) return;

    try {
      // Calculate new total amount (growing with each transfer)
      const nextAuthAmount = totalTransferred + TRANSFER_AMOUNT;
      console.log('Payment Channel Transfer - New authorization details:', {
        previousTotal: totalTransferred,
        nextAmount: nextAuthAmount
      });
      
      // Authorize claim for the growing total
      const claim = await authorizePaymentChannelClaim(nextAuthAmount);
      if (!claim) return;

      // Verify the claim
      const isValid = await verifyPaymentChannelClaim(claim.signature, claim.amount);
      if (!isValid) {
        addLog('❌ Invalid claim');
        return;
      }

      // Update the total transferred amount (keeps growing)
      setTotalTransferred((prev) => prev + TRANSFER_AMOUNT);
      addLog(`✅ Authorized ${nextAuthAmount} XRP (Growing total)`);
      console.log('Payment Channel - Current authorized amount:', nextAuthAmount);
    } catch (error) {
      addLog('❌ Transfer failed');
      setStatus("Error during transfer");
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
        if (isCallActive) { // Check if call is still active
          transferXRP();
        }
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

  const handleStartCall = async () => {
    if (!client || !wallet1 || !wallet2) return;

    try {
      // Create payment channel before starting the call
      addLog('🚀 Starting call - creating payment channel');
      const newChannelId = await createPaymentChannel();
      if (!newChannelId) {
        setStatus("Failed to create payment channel");
        return;
      }

      // Update balances immediately after channel creation
      await updateBalances(client, wallet1, wallet2);
      addLog('💰 Balances updated after channel creation');

      // Reset amounts when starting new call
      setLastAuthorizedAmount(0);
      setTotalTransferred(0);
      setIsCallActive(true);
      setStatus("Call active - payment channel ready");
      addLog('📞 Call started with active payment channel');
    } catch (error) {
      addLog('❌ Failed to start call');
      setStatus("Error starting call");
    }
  };

  const handleEndCall = async () => {
    if (!client || !wallet1 || !wallet2 || !channelId) {
      setIsCallActive(false);
      setTime(0);
      setStatus("Call ended");
      return;
    }

    try {
      // First, stop active transfers
      setIsCallActive(false);
      addLog('🔄 Ending call - processing final claim');
      
      // Make final claim using the total transferred amount
      if (totalTransferred > 0) {
        console.log('Payment Channel End - Final claim amount:', totalTransferred);
        
        // Get final authorization for the total amount
        const finalClaim = await authorizePaymentChannelClaim(totalTransferred);
        if (finalClaim) {
          const isValid = await verifyPaymentChannelClaim(finalClaim.signature, finalClaim.amount);
          if (isValid) {
            // Claim the total amount
            await claimPaymentChannel(finalClaim.signature, finalClaim.amount);
            addLog(`💰 Final claim processed: ${totalTransferred} XRP`);
            
            // Update balances after final claim
            await updateBalances(client, wallet1, wallet2);
            addLog('💰 Final balances updated');
          }
        }
      }

      // Close the payment channel
      await closePaymentChannel();
      
      setTime(0);
      setTotalTransferred(0);
      setLastAuthorizedAmount(0);
      setStatus("Call ended - payment channel closed");
      addLog('📞 Call ended successfully');
    } catch (error) {
      addLog('❌ Error during call end process');
      setStatus("Error ending call");
      setIsCallActive(false);
      setTime(0);
      setTotalTransferred(0);
      setLastAuthorizedAmount(0);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  // Function to burn/destroy an NFT
  const burnNFT = async (nft: NFTData) => {
    if (!client || !wallet2) return;

    addLog('🔥 Burning NFT');

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
        
        const updatedWallet2NFTs = await loadWalletNFTs(client, wallet2.address);
        setWallet2NFTs(updatedWallet2NFTs);
        
        addLog('✅ NFT burned');
      } else {
        throw new Error("Failed to burn NFT");
      }
    } catch (error) {
      addLog('❌ NFT burn failed');
      setStatus(error instanceof Error ? error.message : "Error burning NFT");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="text-xl text-gray-600 mb-4">{status}</div>
        <div className="text-sm text-gray-500 mb-4">Please wait while we connect to the XRPL network...</div>
        {status.includes("Error") && (
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Retry Connection
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen p-8 bg-gray-50">
      {/* Wallet 1 Balances and NFTs */}
      <div className="absolute top-8 left-4 bg-white p-4 rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm text-gray-600">Wallet 1 Balance</div>
          <button
            onClick={() => resetWallet(WALLET1_KEY)}
            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded transition-colors"
            title="Reset wallet and get new funded account"
          >
            Reset Wallet
          </button>
        </div>
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
            <div className="text-sm font-semibold text-gray-600 mb-2">Your Non-Transferable NFTs</div>
            <div className="flex flex-wrap gap-2">
              {wallet1NFTs.map(nft => (
                <button
                  key={nft.id}
                  onClick={() => transferNFT(nft)}
                  className="w-8 h-8 flex items-center justify-center bg-purple-100 rounded hover:bg-purple-200 transition-colors"
                  title={`Transfer ${nft.name} (Non-Transferable NFT) as Issuer`}
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
      
      <div className="absolute top-8 right-4 bg-white p-4 rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm text-gray-600">Wallet 2 Balance</div>
          <button
            onClick={() => resetWallet(WALLET2_KEY)}
            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded transition-colors"
            title="Reset wallet and get new funded account"
          >
            Reset Wallet
          </button>
        </div>
        <div className="text-xl font-bold text-blue-600">
          {wallet2Balance?.toFixed(2)} XRP
        </div>
        <div className="text-xs text-gray-500 mt-1 break-all">
          {wallet2?.address}
        </div>
        <div className="mt-4">
          <div className="text-sm font-semibold text-gray-600 mb-2">Received Soulbound NFTs</div>
          <div className="flex flex-wrap gap-2">
            {wallet2NFTs.map(nft => (
              <button
                key={nft.id}
                onClick={() => burnNFT(nft)}
                className="w-8 h-8 flex items-center justify-center bg-red-100 hover:bg-red-200 rounded transition-colors"
                title={`Burn ${nft.name} (Soulbound NFT)`}
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

      {/* Console Log Display */}
      <div className="fixed bottom-0 right-0 bg-gray-900 bg-opacity-90 text-gray-200 font-mono text-sm w-[400px] max-w-[90vw]">
        <div className="w-full">
          <div className="flex justify-between items-center px-4 py-2 border-b border-gray-700">
            <span className="text-gray-400 text-xs">Console Output</span>
            <button 
              onClick={() => setLogs([])} 
              className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-800"
            >
              Clear
            </button>
          </div>
          <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto" style={{ scrollBehavior: 'smooth' }}>
            {logs.map((log, index) => (
              <div 
                key={`${log.id}_${index}`} 
                className="flex items-start space-x-2 px-2 py-1 hover:bg-gray-800 rounded text-xs"
              >
                <span className="text-gray-500 whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="break-all">{log.message}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-gray-500 text-center py-2 text-xs">
                No logs yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
