import type { Hooks } from "../../../types";
import { getCrossChainRevenue, getOwedFromPriceContext } from "../../sync";

export default class implements Hooks {
  async isOnStateCompute(m3terId: number): Promise<boolean> {
    const [revenue, owed] = await Promise.all([
      getCrossChainRevenue(m3terId), getOwedFromPriceContext(m3terId),
    ]);
    return revenue >= owed;
  }
}
