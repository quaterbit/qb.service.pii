/**
 * Cluster entrypoint for pii provider.
 *
 * Required:
 *   DATABASE_URL    PostgreSQL connection string
 *   PII_MASTER_KEY  Master key for local envelope encryption outside local/test
 *
 * Optional:
 *   HOST                 Runner advertised host (default: 127.0.0.1)
 *   PORT                 Runner cluster port
 *   API_PORT             Public JSON-RPC / health port (default: 4120)
 */
import { BunRuntime } from "@effect/platform-bun"
import { makeClusterEntrypoint } from "@semyenov/n2/runtime"
import { PIIProviderEntityLayer, PIIProviderProxyHandlers, PIIProviderProxyRpcs } from "./entity.js"
import { ClusterInfrastructureLayer } from "./layers.js"
import { MigrationsLayer } from "./migrate.js"

BunRuntime.runMain(
  makeClusterEntrypoint({
    proxyGroup: PIIProviderProxyRpcs,
    path: "/rpc/pii-provider",
    proxyHandlers: PIIProviderProxyHandlers,
    entityLayer: PIIProviderEntityLayer,
    clusterInfrastructureLayer: ClusterInfrastructureLayer,
    migrationsLayer: MigrationsLayer,
    defaultApiPort: 4120,
    observability: {
      serviceName: "pii-provider",
      attributes: {
        "service.namespace": "n2",
        "service.mode": "cluster"
      }
    },
    banner: [
      "PII provider service (cluster mode) on http://localhost:{port}/rpc/pii-provider",
      "Runner cluster port is configured by HOST / PORT"
    ]
  })
)
