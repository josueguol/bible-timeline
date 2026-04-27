# Project Memory

## Context
Sistema para generar contenido histórico estructurado y almacenarlo en base de datos.

## Architecture
- Orquestación → orchestrator
- Investigación → historian-research
- Transformación → backend-sql
- Experiencia visual → ux-ui
- Visualización → frontend-ui

## Principles
- Contract-first
- Separation of concerns
- Validación estricta entre pasos
- Soporte para timelines jerárquicos con zoom progresivo
- Orden cronológico editable a nivel capítulo y expansión posterior a versículos

## Future
- Integrar APIs
- Versionado de contratos
- Persistencia automática
