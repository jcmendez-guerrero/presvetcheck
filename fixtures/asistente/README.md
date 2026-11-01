# Fixtures del asistente de consultas

- `banco.v1.yaml`: banco de evaluación (preguntas de referencia, comportamiento esperado, fuentes y valores que
  deben aparecer). Lo ejecutan, con el
  modelo falso, los tests de `packages/assistant`, y a mano contra el servicio real `pnpm eval:asistente`.
- `chat/*.json`: respuestas **grabadas de llamadas reales** a la API de chat, anonimizadas, para los tests del
  cliente con MSW. No se escriben a mano ni se inventan; si falta una, el test correspondiente queda como
  `it.todo` indicando el fichero que hace falta.
