CIMAVet REST API v1.4

CIMAVet REST API

Tabla de contenido
Forma de acceso ........................................................................................................................... 2

Formato de los datos devueltos .................................................................................................... 2

Especificación ................................................................................................................................ 2

Medicamentos .......................................................................................................................... 2

Presentaciones .......................................................................................................................... 2

Notas de seguridad ................................................................................................................... 2

Maestras .................................................................................................................................... 2

Registro de cambios .................................................................................................................. 3

Tipos de datos complejos devueltos ............................................................................................. 3

Estado ........................................................................................................................................ 3

Documento ................................................................................................................................ 3

Nota ........................................................................................................................................... 3

ATC ............................................................................................................................................ 3

Presentación .............................................................................................................................. 4

PrincipioActivo .......................................................................................................................... 4

Excipiente .................................................................................................................................. 4

Medicamento ............................................................................................................................ 4

Lista de presentaciones ............................................................................................................. 5

Lista de medicamentos ............................................................................................................. 6

Item (Maestras) ......................................................................................................................... 6

Registro de cambios .................................................................................................................. 6

Recursos ........................................................................................................................................ 7

Parámetros comunes ................................................................................................................ 7

GET medicamentos?{condiciones} ............................................................................................ 7

GET medicamento?{condiciones} ............................................................................................. 8

GET presentaciones?{condiciones} ........................................................................................... 8

GET presentacion/{cn} .............................................................................................................. 8

GET maestras?{condiciones} ..................................................................................................... 9

GET/POST registroCambios?{condiciones} ............................................................................... 9

Agencia Española de Medicamentos y Productos Sanitarios

1

CIMAVet REST API v1.4

Forma de acceso

Todos los métodos indicados en el documento se forman desde la URL base
https://cimavet.aemps.es/cimavet/rest/METODO].

Por ejemplo, si se desea invocar al método medicamento por número de registro para el ID
"1173 ESP" la URL será https://cimavet.aemps.es/cimavet/rest/medicamento?nregistro=1173
ESP

Formato de los datos devueltos

Toda la información devuelta por los servicios REST descritos a continuación se encuentra en
formato JSON.

Especificación

Medicamentos
Recursos

Recurso
GET medicamentos?{condiciones}

GET medicamento?{condiciones}

Descripción
Devuelve una lista de medicamentos para las
condiciones enviadas
Devuelve la información de un medicamento
pasando el nº de registro o el código nacional

Presentaciones
Recursos

Recurso
GET presentaciones?{condiciones}  Devuelve una lista de presentaciones para las

Descripción

GET presentacion?{condiciones}

condiciones enviadas
Devuelve la información de una presentación pasando
el código nacional

Notas de seguridad
Recursos

Recurso
GET notas/:nregistro

Maestras
Recursos

Descripción
Devuelve una lista con las notas de seguridad
asociadas a un medicamento por número de registro

Recurso
GET maestras?{condiciones}

Descripción
Devuelve una lista de ítems con la información

Agencia Española de Medicamentos y Productos Sanitarios

2

CIMAVet REST API v1.4

Registro de cambios
Recursos

Recurso
GET registroCambios?{condiciones}

Descripción
Devuelve una lista de registro de cambios con los
medicamentos que han sido dados de alta, de baja
o modificados desde una fecha dada en adelante

Tipos de datos complejos devueltos

Estado
Devuelve la información de los estados de un medicamento. Si está autorizado solo devolverá
la fecha de autorización. Si está revocado o suspendido devolverá también esas fechas

Nombre
aut
susp
rev

Tipo
Fecha
Fecha
Fecha

Descripción
Fecha de autorización del medicamento/presentación
Fecha de suspensión del medicamento/presentación
Fecha de revocación del medicamento/presentación

Documento
Contiene la información relativa a los documentos asociados a un medicamento

Nombre
tipo

url
secc

Tipo
Entero

Texto
Lógico

Descripción
1: Ficha Técnica, 2: Prospecto, 3: Informe Público Evaluación,
4: Plan de gestión de riesgos
URL para acceder al documento
Indica si el documento está disponible en HTML por
secciones

Nota
Contiene la información relativa a las notas de seguridad o informativas asociadas a un
medicamento

Nombre
tipo
num
ref
asunto
fecha
url

ATC
Nombre
codigo
nombre
Nivel

Tipo
Entero
Texto
Texto
Texto
Fecha
Texto

Tipo
Texto
Texto
Entero

Descripción
1: Nota Seguridad
Número de la nota
Referencia asociada a la nota
Asunto asociado a la nota
Fecha de publicación en la AEMPS
URL para acceder a la nota publicada en la AEMPS

Descripción
Código ATC
Nombre descriptivo
Nivel del código ATC

Agencia Española de Medicamentos y Productos Sanitarios

3

CIMAVet REST API v1.4

Presentación
Nombre
cn
nregistro
nombre
estado
Comerc
dispensacion
tipoMedicamento
forma
administracion

PrincipioActivo
Nombre
Id
codigo
nombre
cantidad
unidad
orden

Tipo
Entero
Texto
Texto
Texto
Texto
Entero

Excipiente
Nombre
Id
nombre
doe
cantidad
unidad
orden

Tipo
Entero
Texto
Lógico
Texto
Texto
Entero

Tipo
Texto
Texto
Texto
estado
Lógico
Item
Item
Item
Item

Descripción
Código nacional de la presentación
Nº de registro del medicamento
Nombre del medicamento
Estado de registro de la presentación
Indica si está comercializada o no
Dispensación del formato
Tipo de medicamento
Forma farmacéutica
Administración del medicamento

Descripción
ID de principio activo
Código identificativo del principio activo
Nombre del principio activo
Cantidad de principio activo
Unidad para la cantidad
Orden en la lista de principios activos de un medicamento

Descripción
ID de excipiente
Nombre del excipiente
Declaración obligatoria
Cantidad de excipiente
Unidad para la cantidad
Orden en la lista de excipientes de un medicamento

Indicación/Contraindicación/Interacción
Nombre
Id
nombre
especie

Descripción
ID
Nombre
Especia a la que se asocia

Tipo
Entero
Texto
item

Reacción adversa
Tipo
Nombre
Entero
Id
Texto
nombre
Maestra
especie
Maestra
frecuencia

Tiempo de espera
Tipo
Nombre
cantidad
Numérico
unidadTiempo  Texto
especie
frecuencia

Maestra
Maestra

Descripción
ID
Nombre
Especia a la que se asocia
Frecuencia de aparición

Descripción
Cantidad de tiempo
Unidad de tiempo
Especia a la que se asocia
Frecuencia de aparición

Agencia Española de Medicamentos y Productos Sanitarios

4

CIMAVet REST API v1.4

Medicamento
Nombre
nregistro
nombre
pactivos

Tipo
Texto
Texto
Texto

Texto
Texto
Maestra
Maestra
Maestra
Maestra

excip
labtitular
dispensacion
tipoMedicamento
administracion
forma
primeraAutorizacion  Fecha
estado
estado
Lógico
comerc
Lógico
psum
Lógico
receta
Lógico
estupefaciente
Lógico
psicotropo
Lógico
antibiotico
Lógico
notas
Lógico
ema

docs
atcs
principiosActivos
excipientes
viasAdministracion

documento[]
atc[]
principioActivo[]
Excipiente []
item[]

especies

indicaciones
contraindicaciones
interacciones
reaccionesAdversas
tiemposEspera

item[]

Item[]
item[]
item[]
Item[]
item[]

presentaciones

presentacion[]

Lista de presentaciones
Atributos

Descripción
Nº de registro del medicamento
Nombre del medicamento
Listado de los principios activos separados por
comas
Listado de los excipientes separados por comas
Laboratorio titular del medicamento
Requisito de dispensación
Tipo de medicamento
Requisitos de administración
Forma farmacéutica
Fecha de la primera autorización (Unix timestamp)
Estado de registro del medicamento
Indica si tiene alguna presentación comercializada
Indica si tiene problemas de suministro
Indica si se necesita receta para su dispensación
Medicamento estupefaciente
Medicamento psicótropo
Medicamento antibiótico
Indica si existen notas asociadas al medicamento
Indica si el medicamento se ha registrado por
procedimiento centralizado (EMA) o no
Lista de documentos asociados al medicamento
Lista de códigos ATC asociados al medicamento
Lista de los principios activos del medicamento
Lista de los excipientes del medicamento
Lista de las vías de administración para las que está
autorizado el medicamento
Lista de especies destinos para las que está
autorizado el medicamento
Lista de indicaciones por especie
Lista de contraindicaciones por especie
Lista de interacciones por especie
Lista de reacciones adversas
Lista con los tiempos de espera por especie y
tejido
Lista de presentaciones del medicamento

Nombre
nregistro
cn
nombre
estado
comerc

Tipo
Texto
Texto
Texto
estado
Lógico

Descripción
Nº de registro del medicamento
Código nacional de la presentación
Nombre de la presentación
Estado de registro de la presentación
Indica si está o no comercializada la presentación

Agencia Española de Medicamentos y Productos Sanitarios

5

CIMAVet REST API v1.4

Lista de medicamentos
Atributos

Tipo
Texto
Texto
Texto
Texto
Texto
Maestra
Maestra
Maestra
Maestra
Fecha
estado
estado
Lógico
Lógico
Lógico
Texto
Lógico
Lógico
Lógico

documento
[]
Lógico
Atc[]
Vías[]

Descripción
Nº de registro del medicamento
Nombre del medicamento
Lista de principios activos separada por comas
Lista de excipientes separada por comas
Laboratorio titular del medicamento
Requisito de dispensación
Tipo de medicamento
Requisitos de administración
Forma farmacéutica
Fecha de la primera autorización (Unix timestamp)
Situación administrativa
Estado de registro del medicamento
Indica si tiene alguna presentación comercializada
Indica si se necesita receta para su dispensación
Indica si tiene problemas de suministro
Condiciones de prescripción del medicamento
Medicamento psicotropo
Medicamento estupefaciente
Indica si el medicamento se ha registrado por
procedimiento centralizado (EMA) o no
Lista de documentos asociados al medicamento

Indica si existen notas asociadas al medicamento
Códigos ATC
Vías de administración

Nombre
nregistro
nombre
pactivos
excip
labtitular
dispensacion
tipoMedicamento
administracion
forma
primeraAutorizacion
sitadm
estado
comerc
receta
psum
cpresc
psicotropo
estupefaciente
ema

docs

notas
atc
viasAdministracion

Item (Maestras)
Atributos

Nombre
Id
codigo
nombre

Tipo
Entero
Texto
Texto

Descripción
Identificador numérico del elemento
Identificador alfanumérico del elemento
Nombre del elemento

Registro de cambios
Nombre
nregistro
fecha
tipoCambio

Tipo
Texto
Date
Entero

cambios

Texto[]

Descripción
Nº de registro del medicamento
Fecha en la que se ha producido el cambio
1: Nuevo
2: Baja
3: Modificado
Lista con cadenas de texto que identifican los cambios que
se han producido:

•
•
•

"estado":  estado de autorización
"comerc": estado de comercialización
"prosp":  prospecto

Agencia Española de Medicamentos y Productos Sanitarios

6

CIMAVet REST API v1.4

Nombre

Tipo

Descripción

•
•

"ft": ficha técnica
 "otros": cualquier otro tipo de cambio

Por ejemplo:
    ["estado", "ft"]

Recursos

Parámetros comunes
Todos los métodos que devuelven los resultados paginados permiten un parámetro llamado
"pagina" que indica la página de datos a mostrar.

GET medicamentos?{condiciones}
Devuelve una lista de medicamentos basándose en las condiciones introducidas

Parámetros

Nombre
nombre
laboratorio
practiv1
practiv2
idpractiv1
idpractiv2
cn
atc
nregistro
nregistrobusq

excipiente
idExcipiente
especie
idEspecie
comerc
sitadm
idVia
via
IdForma
forma
tipoMed

administracion
estupefaciente
psicotropo
dispensacion

Descripción
Nombre del medicamento
Nombre del laboratorio
Nombre del principio activo
Nombre del principio activo
ID del principio activo
ID del principio activo
Código nacional
Código ATC o descripción
Nº de registro
Nº de registro para búsquedas con comodines y sin tener en
cuenta espacios
Nombre del excipiente
ID del excipiente
Nombre de la especie destino
ID de la especie destino
1 – Comercializados, 0 – No comercializado, Vacio - Todos
1 – Autorizado, 2 – Suspendidos, 3 - Anulados, Vacio – Todos
ID de la vía de administración
Nombre de la vía de administración
ID forma farmacéutica
Nombre de la forma farmacéutica
1 – Farmacológico, 2 – Inmunológico, 3 – Mixto, 4 –
Homeopáticos, Vacio – Todos
1 – Solo por Veterinario, 2 – Control veterinario, Vacio – Todos
1 – Estupefaciente, 0 – No estupefaciente, Vacio – Todos
1 – Psicótropo, 0 – No psicótropo, vacio – Todos
1 – Sujeto a prescripción, 2 – No sujeto a prescripción, Vacio –
Todos

Agencia Española de Medicamentos y Productos Sanitarios

7

CIMAVet REST API v1.4

GET medicamento?{condiciones}
Devuelve una lista de medicamentos basándose en las condiciones introducidas

Parámetros

Nombre
cn
nregistro

Descripción
Código nacional
Nº de registro

GET presentaciones?{condiciones}
Devuelve una lista de presentaciones basándose en las condiciones introducidas

Parámetros

Nombre
cn
nregistro
comerc

Descripción
Código nacional
Nº de registro
S – Comercializados, vacio - Todos

GET presentacion/{cn}
Devuelve una lista de presentaciones basándose en las condiciones introducidas

Parámetros

Nombre
cn

Descripción
Código nacional

Agencia Española de Medicamentos y Productos Sanitarios

8

CIMAVet REST API v1.4

GET maestras?{condiciones}
Devuelve una lista de elementos (maestras) basándose en las condiciones introducidas

Parámetros

Nombre
maestra

nombre
Id
codigo

Descripción
ID de la maestra a devolver
•  1: Principios activos
•  2: Formas farmacéuticas
•  3: Vías de administración
•  4: Laboratorios
•  5: Códigos ATC
•  6: Excipientes
•  7: Especies destino
•  8: Medicamentos
•  9: Interacciones
•  10: Contraindicaciones
•  11: Indicaciones
•  12: Reacciones adversas
Nombre del elemento a recuperar
ID del elemento a recuperar
Código del elemento a recuperar

GET/POST registroCambios?{condiciones}
Devuelve una lista de elementos (medicamentos modificados) basándose en las condiciones
introducidas

Parámetros

Nombre
fecha

nregistro

Descripción
Fecha a partir de la cual se desea conocer qué medicamentos se
han dado de alta, de baja o se han modificado. La fecha se
introducirá en formato "dd/mm/yyyy"
Limitar la búsqueda a este medicamento. Para incluir más de un
medicamento se debe repetir este parámetro tantas veces como
medicamentos se quieran incluir en la consulta

Agencia Española de Medicamentos y Productos Sanitarios

9


