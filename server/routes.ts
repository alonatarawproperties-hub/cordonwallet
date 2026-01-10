import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/transactions/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const chainId = req.query.chainId as string;
      
      if (!address || !chainId) {
        return res.status(400).json({ error: "Missing address or chainId" });
      }

      const apiKey = process.env.ETHERSCAN_API_KEY;
      
      const params = new URLSearchParams({
        chainid: chainId,
        module: "account",
        action: "txlist",
        address: address,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "50",
        sort: "desc",
      });
      
      if (apiKey) {
        params.append("apikey", apiKey);
      }

      const url = `${ETHERSCAN_V2_API}?${params.toString()}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      res.json(data);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
