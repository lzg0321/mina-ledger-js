import {
  SignTransactionArgs,
  TxType,
  Transport,
  SignTransactionResponse,
  GetAddressResponse,
  GetAppVersionResponse,
  GetAppNameResponse,
} from "./types";
import { Buffer } from "buffer/";
const CLA_LEDGER = 0xb0;
const INS_LEDGER = {
  GET_NAME_VERSION: 0x01,
};
const CLA_APP = 0xe0;
const INS_APP = {
  GET_VERSION: 0x01,
  GET_ADDR: 0x02,
  SIGN: 0x03,
};
const SW_OK = 0x9000;
const SW_CANCEL = 0x6986;

/**
 * Mina App API
 */

export class MinaLedgerJS {
  transport: Transport;

  constructor(transport: Transport, scrambleKey: string = "carbonara") {
    if (transport === null || typeof transport === "undefined") {
      throw new Error("Transport cannot be empty");
    }
    transport.setScrambleKey(scrambleKey);
    this.transport = transport;
  }

  protected pad(
    n: number | string,
    width: number = 3,
    paddingValue: number | string = 0
  ) {
    return (String(paddingValue).repeat(width) + String(n)).slice(
      String(n).length
    );
  }

  protected asciiToHex(str: string) {
    return Buffer.from(str, "ascii").toString("hex");
  }

  protected convertMemo(memo: string) {
    const length = 32;
    let charToAdd = length - memo.length;
    let stringToReturn = memo;
    while (charToAdd > 0) {
      stringToReturn += "\x00";
      charToAdd--;
    }
    return Buffer.from(stringToReturn, "utf8").toString("hex");
  }

  protected createTXApdu({
    txType,
    senderAccount,
    senderAddress,
    receiverAddress,
    amount,
    fee,
    nonce,
    validUntil = 4294967295,
    memo = "",
    networkId,
  }: SignTransactionArgs) {
    const senderBip44AccountHex = this.pad(senderAccount.toString(16), 8);
    const senderAddressHex = this.asciiToHex(senderAddress);
    const receiverHex = this.asciiToHex(receiverAddress);
    const amountHex = this.pad(amount.toString(16), 16);
    const feeHex = this.pad(fee.toString(16), 16);
    const nonceHex = this.pad(Number(nonce).toString(16).toUpperCase(), 8);
    const validUntilHex = this.pad(validUntil.toString(16), 8);
    const memoHex = this.convertMemo(memo);
    const tagHex = this.pad(txType.toString(16), 2);
    const networkIdHex = this.pad(networkId, 2);

    // Uncomment for debug
    // console.log("senderBip44AccountHex", senderBip44AccountHex);
    // console.log("senderAddressHex", senderAddressHex);
    // console.log("receiverHex", receiverHex);
    // console.log("amountHex", amountHex);
    // console.log("feeHex", feeHex);
    // console.log("nonceHex", nonceHex);
    // console.log("validUntilHex", validUntilHex);
    // console.log("memoHex", memoHex);
    // console.log("tagHex", tagHex);
    // console.log("networkIdHex", networkIdHex);

    const apduMessage =
      senderBip44AccountHex +
      senderAddressHex +
      receiverHex +
      amountHex +
      feeHex +
      nonceHex +
      validUntilHex +
      memoHex +
      tagHex +
      networkIdHex;

    // Uncomment for debug
    // console.log(apduMessage);
    // console.log('length: ', apduMessage.length);

    return apduMessage;
  }

  /**
   * Get Mina address for a given account number.
   *
   * @param account int of the account number
   * @param display optionally enable or not the display
   * @return an object with a publicKey
   * @example
   * const result = await Mina.getAddress(1);
   * const { publicKey, returnCode } = result;
   */
  async getAddress(account: number =0): Promise<GetAddressResponse> {
    if (!Number.isInteger(account)) {
      return {
        publicKey: null,
        returnCode: "-5",
        message: "Account number must be Int",
        statusText: "ACCOUNT_NOT_INT",
      };
    }

    const accountHex = this.pad(account.toString(16), 8, 0);
    const accountBuffer = Buffer.from(accountHex, "hex");
    const p1 = 0x00;
    const p2 = 0x00;
    const statusList = [SW_OK, SW_CANCEL];

    try {
      const response = await this.transport.send(
        CLA_APP,
        INS_APP.GET_ADDR,
        p1,
        p2,
        accountBuffer,
        statusList
      );

      const publicKey = response.slice(0, response.length - 3).toString();
      const returnCode = response
        .slice(response.length - 2, response.length)
        .toString("hex");

      if (returnCode !== SW_OK.toString(16)) {
        throw {
          returnCode: returnCode,
          message: "unknown error",
          statusText: "UNKNOWN_ERROR",
        };
      }

      return {
        publicKey,
        returnCode,
      };
    } catch (e) {
      return {
        publicKey: null,
        returnCode: e.returnCode?.toString() || '5000',
        message: e.message,
        statusText: e.statusText,
      };
    }
  }

  // /**
  //  * Sign a Mina transaction with a given transaction
  //  *
  //  * @param Transaction arguments, see SignTransactionArgs type
  //  * @return an object with signature and returnCode
  //  */
  async signTransaction({
    txType,
    senderAccount,
    senderAddress,
    receiverAddress,
    amount,
    fee,
    nonce,
    validUntil = 4294967295,
    memo = "",
    networkId,
  }: SignTransactionArgs): Promise<SignTransactionResponse> {
    if (
      isNaN(txType) ||
      isNaN(senderAccount) ||
      !senderAddress ||
      !receiverAddress ||
      (!amount && txType === TxType.PAYMENT) ||
      !fee ||
      !Number.isInteger(amount) ||
      !Number.isInteger(fee) ||
      isNaN(nonce) ||
      isNaN(networkId)
    ) {
      return {
        signature: null,
        returnCode: "-1",
        message: "Missing or wrong arguments",
        statusText: "MISSING_ARGUMENTS",
      };
    }
    if (memo.length > 32) {
      return {
        signature: null,
        returnCode: "-3",
        message: "Memo field too long",
        statusText: "MEMO_TOO_BIG",
      };
    }
    if (fee < 1000000) {
      return {
        signature: null,
        returnCode: "-4",
        message: "Fee too small",
        statusText: "FEE_TOO_SMALL",
      };
    }

    const apdu = this.createTXApdu({
      txType,
      senderAccount,
      senderAddress,
      receiverAddress,
      amount,
      fee,
      nonce,
      validUntil,
      memo,
      networkId,
    });
    const apduBuffer = Buffer.from(apdu, "hex");
    const p1 = 0x00;
    const p2 = 0x00;
    const statusList = [SW_OK, SW_CANCEL];

    if (apduBuffer.length > 256) {
      return {
        signature: null,
        returnCode: "-2",
        message: "data length > 256 bytes",
        statusText: "DATA_TOO_BIG",
      };
    }

    try {
      const response = await this.transport.send(
        CLA_APP,
        INS_APP.SIGN,
        p1,
        p2,
        apduBuffer,
        statusList
      );

      const signature = response.slice(0, response.length - 2).toString("hex");
      const returnCode = response
        .slice(response.length - 2, response.length)
        .toString("hex");

      return {
        signature,
        returnCode,
      };
    } catch (e) {
      return {
        signature: null,
        returnCode: e.statusCode.toString(),
        message: e.message,
        statusText: e.statusText,
      };
    }
  }

  /**
   * get the version of the Mina app installed on the hardware device
   * the version is returned from the installed app.
   *
   * @return an object with a version
   */
  async getAppVersion(): Promise<GetAppVersionResponse> {
    try {
      const p1 = 0x00;
      const p2 = 0x00;
      const response = await this.transport.send(
        CLA_APP,
        INS_APP.GET_VERSION,
        p1,
        p2
      );
      const versionRaw = response.slice(0, response.length - 2).toString("hex");
      const version =
        "" + versionRaw[1] + "." + versionRaw[2] + "." + versionRaw[3];
      const returnCode = response
        .slice(response.length - 2, response.length)
        .toString("hex");

      return {
        version,
        returnCode,
        deviceLocked: response[4] === 1
      };
    } catch (e) {
      return {
        version: null,
        returnCode: e.statusCode?.toString() || '5000',
        message: e.message,
        statusText: e.statusText,
      };
    }
  }

  /**
   * get the name and version of the Mina app installed on the hardware device
   * it can be used to ping the app and know the name of the running app.
   * The name and version is returned from the Ledger firmware.
   *
   * @return an object with an app name and version
   */
  async getAppName(): Promise<GetAppNameResponse> {
    try {
      const p1 = 0x00;
      const p2 = 0x00;
      const response = await this.transport.send(
        CLA_LEDGER,
        INS_LEDGER.GET_NAME_VERSION,
        p1,
        p2
      );

      const returnCode = response.slice(response.length - 2, response.length).toString("hex");
      const separatorPosition = response.indexOf(0x05)
      const name = response.slice(2, separatorPosition).toString('ascii');
      const version = response.slice(separatorPosition + 1, response.length - 4).toString('utf-8');

      return {
        name, // Mina
        version, // 1.0.0
        returnCode,
      };
    } catch (e) {
      return {
        version: null,
        returnCode: e.statusCode?.toString() || "5000",
        message: e.message,
        statusText: e.statusText,
      };
    }
  }
}
