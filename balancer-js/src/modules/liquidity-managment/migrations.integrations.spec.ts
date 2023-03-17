import { impersonateAccount, reset } from '@/test/lib/utils';
import { expect } from 'chai';
import { Vault__factory } from '@/contracts';
import { BALANCER_NETWORK_CONFIG } from '@/lib/constants/config';
import { JsonRpcProvider, JsonRpcSigner } from '@ethersproject/providers';
import { ERC20 } from '@/modules/contracts/implementations/ERC20';
import {
  metaStable,
  composableStable,
  poolRepository,
  gaugesRepository,
} from './migrations/builder.spec-helpers';
import { Migrations } from './migrations';

const {
  addresses: { contracts },
} = BALANCER_NETWORK_CONFIG[1];
const relayerAddress = contracts.relayerV4 as string;
const provider = new JsonRpcProvider('http://127.0.0.1:8545');
const vault = Vault__factory.connect(contracts.vault, provider);
let signer: JsonRpcSigner;
let address: string;

const migrations = new Migrations(
  relayerAddress,
  poolRepository,
  gaugesRepository,
  provider
);

describe('Migrations', () => {
  beforeEach(async () => {
    await reset('https://rpc.ankr.com/eth', provider, 16820000);
    signer = await impersonateAccount(address, provider);

    // approve relayer
    await vault
      .connect(signer)
      .setRelayerApproval(address, relayerAddress, true);
  });

  context('Metastable to Metastable', () => {
    const from = metaStable;
    const to = from;
    const pool = from.address;

    describe('bptHodler', () => {
      before(() => {
        address = '0x21ac89788d52070D23B8EaCEcBD3Dc544178DC60';
      });

      it('should execute a migration using exit / join', async () => {
        const balance = await ERC20(pool, signer).balanceOf(address);

        const txParams = await migrations.pool2pool(address, from.id, to.id);

        await (await signer.sendTransaction(txParams)).wait();

        const balanceAfter = await ERC20(pool, signer).balanceOf(address);
        const diff = Number(balance.sub(balanceAfter));

        expect(diff).to.be.lt(1e18);
      });
    });

    describe('staked bpt', () => {
      before(() => {
        address = '0xbD454e246d7311F31c8F15C5c5E9f332269Bcc36';
      });

      it('should build a migration using exit / join and stake tokens in the gauge', async () => {
        const gauge = (await gaugesRepository.findBy('poolId', from.id)) as {
          id: string;
        };
        const balance = await ERC20(gauge.id, signer).balanceOf(address);

        const txParams = await migrations.gauge2gauge(address, from.id, to.id);

        await (await signer.sendTransaction(txParams)).wait();

        const balanceAfter = await ERC20(gauge.id, signer).balanceOf(address);
        const diff = Number(balance.sub(balanceAfter));

        expect(diff).to.be.lt(1e18);
      });
    });
  });

  context('ComposableStable to ComposableStable', () => {
    before(() => {
      address = '0x74C3646ADad7e196102D1fE35267aDFD401A568b';
    });

    it('should build a migration using exit / join', async () => {
      const pool = composableStable;
      const balance = await ERC20(pool.address, signer).balanceOf(address);

      const txParams = await migrations.pool2pool(address, pool.id, pool.id);

      await (await signer.sendTransaction(txParams)).wait();

      const balanceAfter = await ERC20(pool.address, signer).balanceOf(address);
      const diff = Number(balance.sub(balanceAfter));

      expect(diff).to.be.lt(1e18);
    });
  });
});
