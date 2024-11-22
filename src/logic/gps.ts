import { readFileSync } from "fs";
import { join } from "path";

export function getGPS(): number[] {
  try {
    const data = readFileSync(join("gps_service", "data.json"), "utf-8");
    const gpsData = JSON.parse(data);
    if (gpsData.onBoard.lat && gpsData.onBoard.lon) {
      return [gpsData.onBoard.lat, gpsData.onBoard.lon];
    } else {
      return [gpsData.wifi.lat, gpsData.wifi.lon];
    }
  } catch (err) {
    return [0.00, 0.00];
  }
}
