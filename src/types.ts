export interface State {
  app_eui: number,
  app_key: number,
  dev_eui: number,
  is_on: boolean;
  total_kwh: number,
  kwh_balance: number;
  last_block: number;
  nonce: number;
  public_key: string;
  token_id: number;
}
export interface Payload {
  0: string;
  1: string;
  2: number[];
}
