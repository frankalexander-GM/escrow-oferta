# clean-code-strict

Estándar de producción para este repositorio. Úsalo al escribir, refactorizar o revisar código.

## Las diez reglas duras

1. **Cero código muerto:** imports, variables, parámetros, funciones y ramas sin uso se borran.
2. **Cero comentarios por defecto:** el código se explica solo. Solo se admiten: licencia, un «por qué» no deducible (workaround con referencia) y docstring de API pública si el proyecto ya los usa. Todo lo demás se borra y se resuelve renombrando.
3. **Cero placeholders:** ni `TODO`, ni `FIXME`, ni `pass`, ni `not implemented`.
4. **Cero errores silenciados:** nada de `catch {}` ni `except: pass`. Si no se puede manejar, se propaga; si se maneja, se registra con contexto.
5. **Cero duplicación de conocimiento:** DRY es sobre conocimiento, no sobre texto parecido.
6. **Cero sobre-ingeniería:** la solución más simple que cumple el contrato.
7. **Nombres que se explican solos:** nada de `data`, `temp`, `aux`, `utils` como cajón de sastre.
8. **Funciones de un solo nivel de abstracción:** una responsabilidad, ~30 líneas, máximo 3 parámetros.
9. **Errores en los límites,** no en cada línea.
10. **Consistencia con el repositorio** por encima del gusto personal.

## Verificación antes de entregar

- `rg "TODO|FIXME|XXX|HACK"`
- `rg "console\\.(log|debug)|debugger|print\\("`
- Linter / typecheck / tests del proyecto.
- Si algo falla, no está listo.

Auditor determinista del proyecto madre: [frankalexander-GM/clean-code-strict](https://github.com/frankalexander-GM/clean-code-strict).

```bash
python scripts/audit_clean_code.py .
```
