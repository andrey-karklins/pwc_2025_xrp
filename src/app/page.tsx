"use client";

import { useState, useEffect } from "react";
import { Client, Wallet, xrpToDrops } from "xrpl";

const TRANSFER_AMOUNT = 1; // Amount to transfer (1 XRP)
const TRANSFER_INTERVAL = 5; // Transfer every 5 seconds
const MAX_TRANSACTIONS = 4; // Maximum number of transactions to show
const WALLET1_KEY = 'xrpl_wallet1';
const WALLET2_KEY = 'xrpl_wallet2';
const RLUSD_ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';

interface Transaction {
  id: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  amount: number;
  from: string;
  to: string;
  sourceAmount?: string;
  destinationAmount?: string;
  sourceCurrency?: string;
  destinationCurrency?: string;
}

interface StoredWallet {
  address: string;
  seed: string;
}

// Helper function to set up trust line for RLUSD
const setupTrustLine = async (client: Client, wallet: Wallet) => {
  try {
    console.log('🔗 Setting up trust line:', { wallet: wallet.address, currency: "USD", issuer: RLUSD_ISSUER });

    const trustSetTx = {
      TransactionType: "TrustSet" as const,
      Account: wallet.address,
      LimitAmount: {
        currency: "USD",
        issuer: RLUSD_ISSUER,
        value: "100" // High limit for testing
      }
    };

    const prepared = await client.autofill(trustSetTx);
    console.log('📝 Trust line prepared:', { 
      fee: (prepared as any).Fee,
      sequence: (prepared as any).Sequence
    });

    const signed = wallet.sign(prepared);
    console.log('✍️ Trust line signed:', { hash: signed.hash });

    const result = await client.submitAndWait(signed.tx_blob);
    console.log('📬 Trust line result:', { 
      status: result.result.meta && typeof result.result.meta !== 'string' ? result.result.meta.TransactionResult : 'unknown'
    });
    
    if (result.result.meta && typeof result.result.meta !== 'string') {
      return result.result.meta.TransactionResult === "tesSUCCESS";
    }
    return false;
  } catch (error) {
    console.error('❌ Trust line error:', error);
    return false;
  }
};

// Helper function to check if trust line exists
const checkTrustLine = async (client: Client, address: string) => {
  try {
    console.log('🔍 Checking trust line:', { address });

    const lines = await client.request({
      command: "account_lines",
      account: address,
      peer: RLUSD_ISSUER
    });
    
    const hasTrustLine = lines.result.lines.some(line => 
      line.currency === "USD" && line.account === RLUSD_ISSUER
    );
    console.log('👀 Trust line status:', { address, exists: hasTrustLine });

    return hasTrustLine;
  } catch (error) {
    console.error('❌ Trust line check error:', error);
    return false;
  }
};

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
  const [wallet1RLUSDBalance, setWallet1RLUSDBalance] = useState<string>("0");
  const [wallet2RLUSDBalance, setWallet2RLUSDBalance] = useState<string>("0");

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
        
        setStatus("Setting up trust lines...");
        // Check and setup trust lines for both wallets
        const wallet1HasTrust = await checkTrustLine(xrplClient, testWallet1.address);
        const wallet2HasTrust = await checkTrustLine(xrplClient, testWallet2.address);
        
        if (!wallet1HasTrust) {
          await setupTrustLine(xrplClient, testWallet1);
        }
        if (!wallet2HasTrust) {
          await setupTrustLine(xrplClient, testWallet2);
        }

        setWallet1(testWallet1);
        setWallet2(testWallet2);

        await updateBalances(xrplClient, testWallet1, testWallet2);
        
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

      const [lines1, lines2] = await Promise.all([
        xrplClient.request({
          command: "account_lines",
          account: w1.address,
          peer: RLUSD_ISSUER
        }),
        xrplClient.request({
          command: "account_lines",
          account: w2.address,
          peer: RLUSD_ISSUER
        })
      ]);

      const rlusd1 = lines1.result.lines.find(l => l.currency === "USD")?.balance || "0";
      const rlusd2 = lines2.result.lines.find(l => l.currency === "USD")?.balance || "0";
      
      console.log('💵 RLUSD balances:', {
        wallet1: { address: w1.address, balance: rlusd1 },
        wallet2: { address: w2.address, balance: rlusd2 }
      });

      setWallet1RLUSDBalance(rlusd1);
      setWallet2RLUSDBalance(rlusd2);
    } catch (error) {
      console.error('❌ Balance update error:', error);
      setStatus("Error updating balances");
    }
  };

  // Handle XRP to RLUSD exchange and transfer
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
      sourceCurrency: "XRP",
      destinationCurrency: "USD",
      sourceAmount: TRANSFER_AMOUNT.toString(),
      destinationAmount: (TRANSFER_AMOUNT * 1).toString()
    };

    setTransactions(prev => [newTransaction, ...prev].slice(0, MAX_TRANSACTIONS));

    try {
      const payment = {
        TransactionType: "Payment" as const,
        Account: wallet1.address,
        Destination: wallet2.address,
        Amount: {
          currency: "USD",
          value: (TRANSFER_AMOUNT * 1).toString(),
          issuer: RLUSD_ISSUER
        },
        SendMax: xrpToDrops(TRANSFER_AMOUNT * 1.05),
        Paths: [[
          {
            currency: "USD",
            issuer: RLUSD_ISSUER,
            type: 48,
            type_hex: "0000000000000030"
          }
        ]]
      };

      console.log('📝 Payment prepared:', { 
        from: payment.Account,
        to: payment.Destination,
        amount: payment.Amount
      });

      const prepared = await client.autofill(payment);
      console.log('✍️ Payment autofilled:', { 
        fee: (prepared as any).Fee,
        sequence: (prepared as any).Sequence
      });

      const signed = wallet1.sign(prepared);
      console.log('📋 Payment signed:', { hash: signed.hash });

      const result = await client.submitAndWait(signed.tx_blob);
      console.log('📬 Payment result:', { 
        status: result.result.meta && typeof result.result.meta !== 'string' ? result.result.meta.TransactionResult : 'unknown',
        hash: result.result.hash
      });

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
                  <span className="text-xs text-gray-500 ml-2">
                    ({tx.sourceCurrency} → {tx.destinationCurrency})
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">{tx.sourceAmount} {tx.sourceCurrency}</span>
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

      {/* Wallet Balances */}
      <div className="absolute top-48 left-4 bg-white p-4 rounded-lg shadow-md">
        <div className="text-sm text-gray-600">Wallet 1 Balance</div>
        <div className="text-xl font-bold text-blue-600">
          {wallet1Balance?.toFixed(2)} XRP
        </div>
        <div className="text-lg font-semibold text-green-600">
          {Number(wallet1RLUSDBalance).toFixed(2)} RLUSD
        </div>
        <div className="text-xs text-gray-500 mt-1 break-all">
          {wallet1?.address}
        </div>
      </div>
      
      <div className="absolute top-48 right-4 bg-white p-4 rounded-lg shadow-md">
        <div className="text-sm text-gray-600">Wallet 2 Balance</div>
        <div className="text-xl font-bold text-blue-600">
          {wallet2Balance?.toFixed(2)} XRP
        </div>
        <div className="text-lg font-semibold text-green-600">
          {Number(wallet2RLUSDBalance).toFixed(2)} RLUSD
        </div>
        <div className="text-xs text-gray-500 mt-1 break-all">
          {wallet2?.address}
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
