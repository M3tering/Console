import * as cron from 'node-cron';
import { 
  getUnverifiedTransactionRecords, 
  markTransactionAsVerified, 
  deleteVerifiedTransactionRecords 
} from "../store/sqlite";
import { 
  getVerifierNodeList, 
  chooseVerifierNode, 
  sendTransactionsToVerifier, 
  checkVerificationStatus,
  TransactionForVerification 
} from "./verification";

/**
 * Daily job: Send all unverified transactions to a verifier node
 */
export async function sendUnverifiedTransactionsJob(): Promise<void> {
  try {
    console.log("🔄 Starting daily job: Send unverified transactions to verifier");
    
    // Get unverified transactions from database
    const unverifiedTransactions = getUnverifiedTransactionRecords() as TransactionForVerification[];
    
    if (unverifiedTransactions.length === 0) {
      console.log("✅ No unverified transactions to send");
      return;
    }
    
    // Get verifier node list from smart contract
    const verifierNodes = await getVerifierNodeList();
    
    if (verifierNodes.length === 0) {
      console.error("❌ No verifier nodes available");
      return;
    }
    
    // Choose a verifier node
    const selectedNode = chooseVerifierNode(verifierNodes);
    
    if (!selectedNode) {
      console.error("❌ Failed to select a verifier node");
      return;
    }
    
    // Send transactions to verifier
    const success = await sendTransactionsToVerifier(unverifiedTransactions, selectedNode);
    
    if (success) {
      console.log("✅ Daily job completed: Sent transactions to verifier", {
        count: unverifiedTransactions.length,
        verifier: selectedNode.id
      });
    } else {
      console.error("❌ Daily job failed: Could not send transactions to verifier");
    }
    
  } catch (err: any) {
    console.error("❌ Daily job error:", err.message);
  }
}

/**
 * Daily job: Check if transactions have been verified and update the verified field
 */
export async function checkVerificationStatusJob(): Promise<void> {
  try {
    console.log("🔄 Starting daily job: Check transaction verification status");
    
    // Get unverified transactions from database
    const unverifiedTransactions = getUnverifiedTransactionRecords() as TransactionForVerification[];
    
    if (unverifiedTransactions.length === 0) {
      console.log("✅ No unverified transactions to check");
      return;
    }
    
    // Get verifier node list from smart contract
    const verifierNodes = await getVerifierNodeList();
    
    if (verifierNodes.length === 0) {
      console.error("❌ No verifier nodes available");
      return;
    }
    
    // Choose a verifier node
    const selectedNode = chooseVerifierNode(verifierNodes);
    
    if (!selectedNode) {
      console.error("❌ Failed to select a verifier node");
      return;
    }
    
    // Check verification status
    const transactionIds = unverifiedTransactions.map(tx => tx.id);
    const verificationResults = await checkVerificationStatus(transactionIds, selectedNode);
    
    // Update verified transactions in database
    let updatedCount = 0;
    for (const result of verificationResults) {
      if (result.verified) {
        const updated = markTransactionAsVerified(result.transactionId);
        if (updated) updatedCount++;
      }
    }
    
    console.log("✅ Daily job completed: Updated verification status", {
      checked: transactionIds.length,
      verified: updatedCount
    });
    
  } catch (err: any) {
    console.error("❌ Daily job error:", err.message);
  }
}

/**
 * Monthly job: Delete verified transactions from the table
 */
export async function deleteVerifiedTransactionsJob(): Promise<void> {
  try {
    console.log("🔄 Starting monthly job: Delete verified transactions");
    
    // Delete all verified transactions
    const deletedCount = deleteVerifiedTransactionRecords();
    
    console.log("✅ Monthly job completed: Deleted verified transactions", {
      count: deletedCount
    });
    
  } catch (err: any) {
    console.error("❌ Monthly job error:", err.message);
  }
}

/**
 * Schedule all verification jobs
 */
export function scheduleVerificationJobs(): void {
  console.log("📅 Scheduling verification jobs...");
  
  // Run daily at 2 AM - Send unverified transactions
  cron.schedule('0 2 * * *', async () => {
    console.log("⏰ Daily job triggered: Send unverified transactions");
    await sendUnverifiedTransactionsJob();
  }, {
    timezone: "UTC"
  });
  
  // Run daily at 4 AM - Check verification status
  cron.schedule('0 4 * * *', async () => {
    console.log("⏰ Daily job triggered: Check verification status");
    await checkVerificationStatusJob();
  }, {
    timezone: "UTC"
  });
  
  // Run monthly on the 1st at 1 AM - Delete verified transactions
  cron.schedule('0 1 1 * *', async () => {
    console.log("⏰ Monthly job triggered: Delete verified transactions");
    await deleteVerifiedTransactionsJob();
  }, {
    timezone: "UTC"
  });
  
  console.log("✅ Verification jobs scheduled:");
  console.log("  - Daily at 02:00 UTC: Send unverified transactions to verifier");
  console.log("  - Daily at 04:00 UTC: Check verification status");
  console.log("  - Monthly on 1st at 01:00 UTC: Delete verified transactions");
}

/**
 * Run verification jobs manually (for testing)
 */
export async function runVerificationJobsManually(): Promise<void> {
  console.log("🧪 Running verification jobs manually for testing...");
  
  await sendUnverifiedTransactionsJob();
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  
  await checkVerificationStatusJob();
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  
  // Note: Monthly job would typically not be run in testing
  // await deleteVerifiedTransactionsJob();
  
  console.log("🧪 Manual verification jobs completed");
}
