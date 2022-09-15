import dotenv from 'dotenv';
import { expect } from 'chai';
import hardhat from 'hardhat';

import { BalancerSDK, Network } from '@/.';
import { BigNumber, parseFixed } from '@ethersproject/bignumber';
import { Contracts } from '@/modules/contracts/contracts.module';
import { forkSetup, getBalances } from '@/test/lib/utils';
import { ADDRESSES } from '@/test/lib/constants';
import { Relayer } from '@/modules/relayer/relayer.module';

/*
 * Testing on GOERLI
 * - Update hardhat.config.js with chainId = 5
 * - Update ALCHEMY_URL on .env with a goerli api key
 * - Run node on terminal: yarn run node
 * - Uncomment section below:
 */
const network = Network.GOERLI;
const blockNumber = 7596322;
const subgraph = `https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-goerli-v2-beta`;
const bbausd2id =
  '0x3d5981bdd8d3e49eb7bbdc1d2b156a3ee019c18e0000000000000000000001a7';
const bbausd2address = '0x3d5981bdd8d3e49eb7bbdc1d2b156a3ee019c18e';
const bbadai = '0x594920068382f64e4bc06879679bd474118b97b1';
const bbausdc = '0x4d983081b9b9f3393409a4cdf5504d0aea9cd94c';

/*
 * Testing on MAINNET
 * - Update hardhat.config.js with chainId = 1
 * - Update ALCHEMY_URL on .env with a mainnet api key
 * - Run node on terminal: yarn run node
 * - Uncomment section below:
 */
// const network = Network.MAINNET;
// const blockNumber = 15519886;
// const subgraph = `https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2-beta`;
// const bbausd2id =
//   '0xa13a9247ea42d743238089903570127dda72fe4400000000000000000000035d';
// const bbausd2address = '0xa13a9247ea42d743238089903570127dda72fe44';
// const bbadai = '0xae37d54ae477268b9997d4161b96b8200755935c';

dotenv.config();

const { ALCHEMY_URL: jsonRpcUrl } = process.env;
const { ethers } = hardhat;
const MAX_GAS_LIMIT = 8e6;

const rpcUrl = 'http://127.0.0.1:8545';
const sdk = new BalancerSDK({
  network,
  rpcUrl,
  customSubgraphUrl: subgraph,
});
const { pools } = sdk;
const provider = new ethers.providers.JsonRpcProvider(rpcUrl, network);
const signer = provider.getSigner();
const { contracts, contractAddresses } = new Contracts(
  network as number,
  provider
);
const relayer = contractAddresses.relayer as string;
const addresses = ADDRESSES[network];
const fromPool = {
  id: bbausd2id,
  address: bbausd2address,
};
const mainTokens = [addresses.DAI.address, addresses.USDC.address];
// joins with wrapping require token approvals. These are taken care of as part of fork setup when wrappedTokens passed in.
const wrappedTokensIn = [
  addresses.waUSDT.address,
  addresses.waDAI.address,
  addresses.waUSDC.address,
];
const linearPoolTokens = [bbadai, bbausdc];
const slots = [addresses.DAI.slot, addresses.USDC.slot];
const wrappedSlots = [
  addresses.waUSDT.slot,
  addresses.waDAI.slot,
  addresses.waUSDC.slot,
];
const linearPoolSlots = [0, 0];
const mainInitialBalances = [
  parseFixed('100', addresses.DAI.decimals).toString(),
  parseFixed('100', addresses.USDC.decimals).toString(),
];
const wrappedInitialBalances = ['0', '0', '0'];
const linearInitialBalances = [
  parseFixed('100', 18).toString(),
  parseFixed('100', 18).toString(),
];


describe('bbausd generalised join execution', async () => {
  let signerAddress: string;
  let authorisation: string;

  beforeEach(async function () {
    signerAddress = await signer.getAddress();

    await forkSetup(
      signer,
      [...mainTokens, ...wrappedTokensIn, ...linearPoolTokens],
      [...slots, ...wrappedSlots, ...linearPoolSlots],
      [
        ...mainInitialBalances,
        ...wrappedInitialBalances,
        ...linearInitialBalances,
      ],
      jsonRpcUrl as string,
      blockNumber
    );

    authorisation = await Relayer.signRelayerApproval(
      relayer,
      signerAddress,
      signer,
      contracts.vault
    );
  });

  const testFlow = async (
    tokensIn: string[],
    amountsIn: string[],
    wrapMainTokens: boolean,
    previouslyAuthorised = false
  ) => {
    const [bptBalanceBefore, ...tokensInBalanceBefore] = await getBalances(
      [fromPool.address, ...tokensIn],
      signer,
      signerAddress
    );

    const gasLimit = MAX_GAS_LIMIT;
    const slippage = '10'; // 10 bps = 0.1%

    const query = await pools.generalisedJoin(
      fromPool.id,
      tokensIn,
      amountsIn,
      signerAddress,
      wrapMainTokens,
      slippage,
      signer,
      previouslyAuthorised ? undefined : authorisation
    );

    const response = await signer.sendTransaction({
      to: query.to,
      data: query.callData,
      gasLimit,
    });

    const receipt = await response.wait();
    console.log('Gas used', receipt.gasUsed.toString());

    const [bptBalanceAfter, ...tokensInBalanceAfter] = await getBalances(
      [fromPool.address, ...tokensIn],
      signer,
      signerAddress
    );
    expect(receipt.status).to.eql(1);
    expect(BigNumber.from(query.minOut).gte('0')).to.be.true;
    expect(BigNumber.from(query.expectedOut).gt(query.minOut)).to.be.true;
    tokensInBalanceAfter.forEach((balanceAfter, i) => {
      expect(balanceAfter.toString()).to.eq(
        tokensInBalanceBefore[i].sub(amountsIn[i]).toString()
      );
    });
    tokensInBalanceAfter.forEach((b) => expect(b.toString()).to.eq('0'));
    expect(bptBalanceBefore.eq(0)).to.be.true;
    expect(bptBalanceAfter.gte(query.minOut)).to.be.true;
    console.log(bptBalanceAfter.toString(), 'bpt after');
    console.log(query.minOut, 'minOut');
    console.log(query.expectedOut, 'expectedOut');
  };
  context('leaf token input', async () => {
    it('joins with no wrapping', async () => {
      await testFlow(mainTokens, mainInitialBalances, false);
    }).timeout(2000000);
    it('joins with wrapping', async () => {
      await testFlow(mainTokens, mainInitialBalances, true);
    });
  });
  context('linear pool token as input', async () => {
    it('joins boosted pool with single linear input', async () => {
      await testFlow([linearPoolTokens[0]], [linearInitialBalances[0]], false);
    });
    it('joins boosted pool with 2 linear input', async () => {
      await testFlow(linearPoolTokens, linearInitialBalances, false);
    });
  });

  context('leaf and linear pool tokens as input', async () => {
    it('joins boosted pool', async () => {
      await testFlow(
        [mainTokens[1], ...linearPoolTokens],
        [mainInitialBalances[1], ...linearInitialBalances],
        false
      );
    });
  });
});
