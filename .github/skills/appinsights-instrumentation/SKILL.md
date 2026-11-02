---
name: appinsights-instrumentation
description: 'Instrument the Node.js API and worker of this repository to send telemetry to Azure Application Insights'
---

# AppInsights instrumentation

Send telemetry from the Node.js apps in this repository (`apps/api`, `apps/worker`, hosted in Azure Container
Apps) to Azure Application Insights.

## When to use this skill

Use this skill when the user wants to add or change telemetry for the API or the worker jobs.

## Guidelines

- The Application Insights resource already exists in the Bicep templates (`infra/main.bicep`,
  `infra/np/main.bicep`) and its connection string reaches the apps as `APPLICATIONINSIGHTS_CONNECTION_STRING`.
  If a new template needs it, see [examples/appinsights.bicep](examples/appinsights.bicep).
- For code changes, follow the [NODEJS guide](references/NODEJS.md).
- Never send personal data (owner name, phone, ID number, address) in traces, logs, custom events or
  exception messages (see `AGENTS.md`).
