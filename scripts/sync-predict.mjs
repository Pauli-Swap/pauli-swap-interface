// Copies the QRVM ABIs and the deployments of PauliSwap Predict and its QRL faucet from the
// pauli-swap-prediction-market repo. Without a deployment for the network the
// contracts map is written empty, so the app builds and the Predict pages show
// that nothing is deployed.
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(process.argv[2] ?? '../pauli-swap-prediction-market');
const network = process.argv[3] ?? 'devnet';
const out = path.resolve('src/contracts');
const artifactsDir = path.join(repo, 'build', 'qrvm');
const index = JSON.parse(fs.readFileSync(path.join(artifactsDir, 'index.json'), 'utf8'));

const CONTRACTS = ['PauliPredictXP', 'PredictMarket', 'QrlFaucet'];

fs.mkdirSync(path.join(out, 'abi'), { recursive: true });
for (const name of CONTRACTS) {
  const [unit] = index[name];
  const artifact = JSON.parse(fs.readFileSync(path.join(artifactsDir, unit, `${name}.json`), 'utf8'));
  fs.writeFileSync(path.join(out, 'abi', `${name}.json`), JSON.stringify(artifact.abi, null, 2) + '\n');
}

const file = path.join(repo, 'deployments', `${network}.json`);
let deployment = { network, chainId: null, startBlock: 0, deployedAt: null, contracts: {} };
if (fs.existsSync(file)) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const contracts = Object.fromEntries(CONTRACTS.filter((c) => d.contracts?.[c]).map((c) => [c, d.contracts[c]]));
  deployment = { network: d.network, chainId: d.chainId, startBlock: d.startBlock, deployedAt: d.deployedAt, contracts };
}
fs.writeFileSync(path.join(out, `predict-${network}.json`), JSON.stringify(deployment, null, 2) + '\n');

const faucetFile = path.join(repo, 'deployments', `faucet-${network}.json`);
let faucet = { network, chainId: null, startBlock: 0, deployedAt: null, dripPlanck: '0', cooldownSeconds: 0, contracts: {} };
if (fs.existsSync(faucetFile)) {
  const d = JSON.parse(fs.readFileSync(faucetFile, 'utf8'));
  faucet = { network: d.network, chainId: d.chainId, startBlock: d.startBlock, deployedAt: d.deployedAt, dripPlanck: d.terms.dripPlanck, cooldownSeconds: d.terms.cooldownSeconds, contracts: d.contracts };
}
fs.writeFileSync(path.join(out, `faucet-${network}.json`), JSON.stringify(faucet, null, 2) + '\n');
console.log(
  `synced ${CONTRACTS.length} Predict ABIs; ${network}: ${Object.keys(deployment.contracts).length ? `deployed at block ${deployment.startBlock}` : 'no deployment'}; faucet ${faucet.contracts.QrlFaucet ? `at block ${faucet.startBlock}` : 'not deployed'}`,
);
