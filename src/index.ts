import "dotenv/config";
import {db} from "./config/db";
import {create} from "express-handlebars";
import bodyParser from "body-parser";
import {handleUplinks} from "./logic/mqtt";
import express, {Express, Request, Response} from "express";

import path from "path";

const port = process.env.PORT || 3000;
const app: Express = express();


const hbs = create({ defaultLayout: 'main', extname: 'hbs', helpers: {
    loadM3ters(context: any, options: any) {
      return (
          `<tr> 
              <td>${options.fn(context[0])}</td>
              <td>${options.fn(context[1].tokenId)}</td>
              <td>${options.fn(context[1].contractId)}</td>
          </tr>`
      );
    }
  }
});

app.engine("hbs", hbs.engine);
app.set('views', path.join(__dirname, 'views'));
app.set("view engine", "hbs");

app.use(express.static("public"));
app.use(bodyParser.json());
handleUplinks();

app.get("/", async (req: Request, res: Response) => {
  const m3ters = await db.iterator().all();
  for (let i = 0; i < m3ters.length; i++) {
    m3ters[i][1] = JSON.parse(m3ters[i][1]);
  }
  res.render("index", { m3ters });
});

app.post("/", async (req: Request, res: Response) => {
  try {
    let body = await req.body;
    console.log(body);
    const { publicKey, tokenId, contractId } = body;
    await db.put(publicKey, JSON.stringify({tokenId, contractId}));
    res.status(200).send("Item Added");
  } catch (error) {
    console.log(error);
    res.status(400).send(error);
  }
});

app.delete("/:publicKey", async (req: Request, res: Response) => {
  await db.del(req.params.publicKey);
  res.status(200).send("Item Deleted");
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
