# wdk-hinkal-demo

Private USDC transfers on Base, through [Hinkal](https://hinkal-team.gitbook.io/hinkal), on the [WDK](https://docs.wdk.tether.io) wallet stack.

`@hinkal/wdk-wallet-evm-hinkal` extends WDK's `WalletManagerEvm` / `WalletAccountEvm`. Every account keeps the standard WDK methods and gains four more. This demo drives them end to end.

## Setup

```sh
npm install
cp .env.example .env   # fill in SEED and RECIPIENT
```

The wallet needs USDC on Base plus a little ETH for gas.

## Commands

```sh
npm run preflight    # address, USDC balance, gas balance
npm run send         # private send, then poll until it settles
npm run send:stuck   # strand a UTXO on purpose, to test recovery
npm run recover      # list stranded shielded balances and withdraw them
```

There is no confirmation prompt. `send` and `send:stuck` move real funds on Base mainnet as soon as you run them.

## The integration, in a few lines

```js
import WalletManagerEvmHinkal from '@hinkal/wdk-wallet-evm-hinkal'

const wallet = new WalletManagerEvmHinkal(SEED, { provider: RPC_URL })
const account = await wallet.getAccount(0)

// Private send: deposits on-chain now, the shielded withdrawal settles after.
const { depositTxHash, scheduleId } = await account.privateSend({
  token: USDC_BASE,
  recipient: RECIPIENT,
  amount: 100_000n // 0.1 USDC
})

// Track the scheduled withdrawal.
const status = await account.getSendStatus(scheduleId)

// Recover anything left stranded in Hinkal.
const balances = await account.stuckUtxoBalances()
const { hashes } = await account.withdrawStuckUtxos({ token: USDC_BASE })
```

Chain selection is implicit: the operation runs on whatever chain `provider` is connected to. The demo asserts that chain is Base (8453) before doing anything.

## Testing recovery

A private send has two legs. The deposit lands on-chain immediately; the shielded withdrawal to the recipient settles afterwards. If that second leg cannot settle, the funds stay in the pool as a stranded UTXO — not lost, but not delivered either.

`npm run send:stuck` produces that state deliberately: it sends native ETH with the USDC contract as the recipient, which cannot receive the withdrawal. Then `npm run recover` lists what is stranded and withdraws it back to your own address.

```sh
npm run send:stuck   # deposit lands, withdrawal cannot settle
npm run recover      # stuckUtxoBalances() -> withdrawStuckUtxos()
```

The amount defaults to 0.0001 ETH; override with `STUCK_AMOUNT`.

## Configuration

| Variable       | Default                     | Meaning                                  |
| -------------- | --------------------------- | ---------------------------------------- |
| `SEED`         | —                           | BIP-39 mnemonic of a funded Base wallet  |
| `RPC_URL`      | `https://mainnet.base.org`  | Base RPC endpoint                        |
| `RECIPIENT`    | —                           | Destination for `send`                   |
| `AMOUNT`       | `100000`                    | USDC base units (6 decimals), so 0.1     |
| `STUCK_AMOUNT` | `100000000000000`           | ETH wei for `send:stuck`, so 0.0001      |

For anything beyond light testing, use your own Alchemy or Infura endpoint — public RPCs are rate-limited.

## Why the build step

`@hinkal/common`'s ESM build does not load under Node directly, so `npm run build` bundles the demo to CommonJS with esbuild and leaves the SDK external. Every script runs that build first. This is the same setup the package README documents for Node applications.

Note that `@hinkal/common` and `sodium-universal` are direct dependencies here even though esbuild marks them external — Node resolves externals from this project's own `node_modules`, not from the linked package's tree.

## Notes on fees

`privateSend` is not quoted before it runs. Hinkal builds, signs, and submits the deposit inside the SDK, and the relayer's fee is taken from the shielded amount afterwards. WDK's `transactionMaxFee` / `transferMaxFee` caps apply to `sendTransaction` and `transfer`, not to this path — constrain the amount you pass instead.
