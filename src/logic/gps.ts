import { readFileSync } from "fs";
import { join } from "path";

export function getGPS(): number[] {
  try {
    const data = readFileSync(join("gps_service", "data.json"), "utf-8");
    const gpsData = JSON.parse(data);
    if (gpsData.onBoard.lat && gpsData.onBoard.lon) {
      return [gpsData.onBoard.lat.toFixed(2), gpsData.onBoard.lon.toFixed(2)];
    } else {
      return [gpsData.wifi.lat.toFixed(2), gpsData.wifi.lon.toFixed(2)];
    }
  } catch (err) {
    return [0.00, 0.00];
  }
}
