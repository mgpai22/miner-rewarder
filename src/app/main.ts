import dotenv from 'dotenv';
import { BackendWallet } from '../rust/BackendWallet';
import { Network } from '@fleet-sdk/core';
import { ExplorerAPI } from '../explorer-api/api';
import { getInputBoxes } from '../utils/input-selecter';
import { getSimpleOutbox } from '../utils/outbox-helper';
import { NodeAPI } from '../node-api/api';
import path from 'path';
import { checkApi, checkEnv } from '../utils/check';
import { getRewardAddresses } from '../utils/rewarder-selector';
import { TransactionHelper } from '../utils/transaction-helper';
import logger from '../logger/logger';
import { readFile, writeFile } from 'fs/promises';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const result = dotenv.config({
    path: path.resolve(import.meta.dir, '../..', '.env'),
  });

  if (!checkEnv(result)) {
    return;
  }

  const addressIndex = Number(process.env.ADDRESS_INDEX!);
  const mnemonic = process.env.MNEMONIC!;
  const mnemonicPw = process.env.MNEMONIC_PW!; // generally empty for most people

  let params;
  let file;

  try {
    file = await readFile('params.json', 'utf8');
    params = JSON.parse(file);
  } catch (error) {
    logger.error(error);
    logger.info('could not access params file');
    logger.info('program terminated');
    return;
  }

  const {
    startBlockHeight,
    rewardInterval,
    rewardToken,
    nanoErgPerTx,
    nanoErgMinerFee,
    nodeUrl,
    explorerApi,
    blacklist,
  } = params;
  let mutStartBlockHeight = startBlockHeight;

  await checkApi(nodeUrl, explorerApi);

  const explorer = new ExplorerAPI(explorerApi);
  const node = new NodeAPI(nodeUrl);
  const network =
    (await node.getNetwork()) === 'mainnet' ? Network.Mainnet : Network.Testnet;

  const wallet = new BackendWallet(mnemonic, mnemonicPw, network);
  const address = wallet.getAddress(addressIndex);

  logger.info(`wallet: ${address} connected`);

  await sleep(3000);

  const currentHeight = await node.getHeight();

  if (!currentHeight) {
    throw new Error('could not access node height');
  }

  let prevHeight = currentHeight - 1;

  while (true) {
    try {
      const currentHeight = await node.getHeight();

      if (!currentHeight) {
        throw new Error('could not access node height');
      }

      if (currentHeight > prevHeight) {
        const rewardAddress = await getRewardAddresses(
          mutStartBlockHeight,
          currentHeight,
          rewardInterval,
          node,
          network,
          blacklist,
        );

        if (rewardAddress.length > 0) {
          logger.info(`rewarding ${rewardAddress.length} address(es)`);

          const inputs = await getInputBoxes(
            explorer,
            address,
            BigInt(nanoErgPerTx) * BigInt(rewardAddress.length),
            [
              {
                tokenId: rewardToken.tokenId,
                amount:
                  BigInt(rewardToken.amount) * BigInt(rewardAddress.length),
              },
            ],
          );

          const outputs = rewardAddress.map((address) =>
            getSimpleOutbox(nanoErgPerTx, address, [rewardToken]),
          );

          const transactionHelper = new TransactionHelper(
            node,
            mnemonic,
            mnemonicPw,
            addressIndex,
            network,
          );

          const rewardTx = await transactionHelper.buildTransaction(
            inputs,
            outputs,
            nanoErgMinerFee,
          );

          const rewardTxSigned =
            await transactionHelper.signTransaction(rewardTx);

          const rewardTxId = await node.submitTransaction(rewardTxSigned);

          if (!rewardTxId) {
            throw new Error(`error submitting reward tx`);
          }

          if ((rewardTxId as any).id) {
            logger.info(`Reward Tx submitted: ${(rewardTxId as any).id}`);
            try {
              params.startBlockHeight = mutStartBlockHeight;
              const newParams = {
                startBlockHeight: mutStartBlockHeight,
                rewardInterval: params.rewardInterval,
                rewardToken: params.rewardToken,
                nanoErgPerTx: params.nanoErgPerTx,
                nanoErgMinerFee: params.nanoErgMinerFee,
                nodeUrl: params.nodeUrl,
                explorerApi: params.explorerApi,
                blacklist: params.blacklist,
              };
              await writeFile('params.json', JSON.stringify(newParams, null, 2));
              logger.debug(`wrote to file, new height: ${mutStartBlockHeight}`);
            } catch (error) {
              logger.error('could not write to file');
              throw new Error('could not write to file');
            }
          }
          mutStartBlockHeight = currentHeight + 1;
        }

        prevHeight = currentHeight;
      }
      logger.debug('sleeping 30 seconds');
      await sleep(30000);
    } catch (error) {
      logger.info(error);
      break;
    }
  }

  logger.info('program terminated due to error');
  return;
}

main();
