# M3tering Console Setup

## Quick Setup

1. **Clone/Update**

   ```bash
   git clone https://github.com/M3tering/Console.git
   # or
   cd Console/ && git pull
   ```

2. **Environment Variables**
   Create `.env` file:

   ```
   PORT=3000
   API_TOKEN=...
   APPLICATION_ID=...
   CONTRACT_LABEL=M3ters
   CHIRPSTACK_HOST=localhost
   MAINNET_RPC=https://sepolia.drpc.org
   PREFERRED_PROVER_NODE=http://34.244.149.153
   STREAMR_STREAM_ID="0x123.../foo/ba"
   ETHEREUM_PRIVATE_KEY="..."
   ```

3. **Docker Build and Run**

   ```bash
   sudo docker compose down
   sudo docker compose up -d
   ```

## Other Docker Commands

- `sudo docker ps` - list running containers
- `sudo docker ps -a` - list all containers  
- `sudo docker compose down` - stop container
- `sudo docker compose logs` - view logs
- `sudo docker compose logs -tf` - follow logs with timestamps
- `sudo docker system prune` - cleanup unused containers/images
- `sudo docker system prune -a` - cleanup everything unused

## Development

```bash
npm install
npm run dev
```
