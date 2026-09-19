"use strict";

import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";

import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import WalletManagerEvmHinkal, {
  HinkalError,
} from "@hinkal/wdk-wallet-evm-hinkal";

const BASE_CHAIN_ID = 8453;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const MIN_GAS_WEI = 20_000_000_000_000n;
const DONE = new Set(["completed", "failed", "cancelled", "reverted"]);

const transfer = {
  token: USDC_BASE,
  recipient: process.env.RECIPIENT,
  amount: BigInt(process.env.AMOUNT || "100000"),
};

async function createAccount() {
  if (!process.env.SEED) throw new Error("Set SEED (see .env.example).");

  const wallet = new WalletManagerEvmHinkal(process.env.SEED, {
    provider: RPC_URL,
  });
  return wallet.getAccount(0);
}

async function assertBaseRpc() {
  const provider = new JsonRpcProvider(RPC_URL);
  const { chainId } = await provider.getNetwork();
  provider.destroy();

  if (Number(chainId) !== BASE_CHAIN_ID) {
    throw new Error(`RPC is on chain ${chainId}, expected Base (8453).`);
  }
  console.log(`RPC chain: Base (${chainId})`);
}

async function preflight(account) {
  const provider = new JsonRpcProvider(RPC_URL);
  const address = await account.getAddress();
  const usdc = new Contract(
    USDC_BASE,
    ["function balanceOf(address) view returns (uint256)"],
    provider,
  );

  const [balance, gas] = await Promise.all([
    usdc.balanceOf(address),
    provider.getBalance(address),
  ]);
  provider.destroy();

  console.log(`\nAddress:    ${address}`);
  console.log(`Base USDC:  ${formatUnits(balance, USDC_DECIMALS)}`);
  console.log(`Base ETH:   ${formatUnits(gas, 18)}`);

  if (balance < transfer.amount) throw new Error("Not enough USDC.");
  if (gas < MIN_GAS_WEI) throw new Error("Not enough ETH for gas.");
}

async function waitForStatus(account, scheduleId) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (attempt > 1) await sleep(10_000);

    const { transactions = [] } = await account.getSendStatus(scheduleId);
    const status = transactions.at(-1)?.status ?? "pending";
    console.log(`Status ${attempt}/60: ${status}`);

    if (DONE.has(status)) return status;
  }
  return "timed out";
}

async function send(account) {
  if (!transfer.recipient) throw new Error("Set RECIPIENT (see .env.example).");

  await preflight(account);

  console.log(`\nSend ${formatUnits(transfer.amount, USDC_DECIMALS)} USDC`);
  console.log(`To   ${transfer.recipient}`);

  const { depositTxHash, scheduleId } = await account.privateSend(transfer);
  console.log(`\nDeposit: https://basescan.org/tx/${depositTxHash}`);
  console.log(`Schedule id: ${scheduleId}`);

  console.log(`\nFinal status: ${await waitForStatus(account, scheduleId)}`);
}

async function sendStuck(account) {
  const stuck = {
    token: NATIVE_ETH,
    recipient: USDC_BASE,
    amount: BigInt(process.env.STUCK_AMOUNT || "100000000000000"),
  };

  console.log(`\nSend ${formatUnits(stuck.amount, 18)} ETH`);
  console.log(`To   ${stuck.recipient} (the USDC contract, on purpose)`);
  console.log("Why  the withdrawal cannot settle, so it strands in the pool");

  const { depositTxHash, scheduleId } = await account.privateSend(stuck);
  console.log(`\nDeposit: https://basescan.org/tx/${depositTxHash}`);
  console.log(`Schedule id: ${scheduleId}`);
  console.log("\nNow run: npm run recover");
}

async function recover(account) {
  const balances = await account.stuckUtxoBalances();
  if (balances.length === 0) {
    console.log("\nNothing stuck.");
    return;
  }

  console.log("\nStuck shielded balances:");
  for (const { token, balance } of balances) {
    console.log(`  ${token}  ${balance}`);
  }

  for (const { token } of balances) {
    const { hashes } = await account.withdrawStuckUtxos({ token });
    for (const hash of hashes) {
      console.log(`Recovered: https://basescan.org/tx/${hash}`);
    }
  }
}

const commands = {
  preflight,
  send,
  "send:stuck": sendStuck,
  recover,
};

const run = commands[process.argv[2]];
if (!run) {
  console.error(`Usage: node demo.js <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}

async function main() {
  await assertBaseRpc();

  const account = await createAccount();
  try {
    await run(account);
  } finally {
    account.dispose();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const actionable = err instanceof HinkalError && err.isUserActionable;
    console.error(`\n${actionable ? err.message : (err.stack ?? err)}`);
    process.exit(1);
  });
