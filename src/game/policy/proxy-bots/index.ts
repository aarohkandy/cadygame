// src/game/policy/proxy-bots/index.ts (WP4)
// Proxy bot factory (GAME_DESIGN 5.5.7, BUILD_PLAN D3). This build ships one bot, `human_proxy`, which the
// replay-verify and headless-runner tests use to play a human seat through the real PilotController. It is not
// offered in the Lab. Every bot is wrapped in the proxy driver, which digests its synthetic input stream.

import type { CreateProxyBot, ProxyBotId } from "../../contracts.ts";
import { createProxyDriver } from "../proxy-driver.ts";
import { createHumanProxy } from "./human-proxy.ts";

export const PROXY_BOT_IDS: readonly ProxyBotId[] = ["human_proxy"];

export const createProxyBot: CreateProxyBot = (id: ProxyBotId) => {
  switch (id) {
    case "human_proxy":
      return createProxyDriver(createHumanProxy());
  }
};
