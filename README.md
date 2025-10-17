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
   CHIRPSTACK_HOST=host.docker.internal
   MAINNET_RPC=https://sepolia.drpc.org
   PREFERRED_PROVER_NODE=http://34.244.149.153
   ```

3. **Docker Build**

   ```bash
   sudo docker build -t console .
   # If error: sudo systemctl restart docker
   ```

4. **Docker Run**
   ```bash
   sudo docker run -detach --restart unless-stopped --add-host=host.docker.internal:host-gateway console
   ```

## Docker Commands

- `sudo docker ps` - list running containers
- `sudo docker ps -a` - list all containers  
- `sudo docker stop <container_id>` - stop container
- `sudo docker rm <container_id>` - remove container
- `sudo docker logs <container_id>` - view logs
- `sudo docker logs -f -t <container_id>` - follow logs with timestamps
- `sudo docker system prune` - cleanup unused containers/images
- `sudo docker system prune -a` - cleanup everything unused

## Development

```bash
npm install
npm run dev
```
