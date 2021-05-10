
# Protocolo RetroProt

Versión 1.0, 14-3-2021
yomboprime

## Índice

- Descripción
- Ciclo de transmisión de datos
- Comandos del cliente:
	- Comando "listRooms"
	- Comando "createRoom"
	- Comando "enterRoom"
	- Comando "leaveRoom"
	- Comando "disconnect"
	- Comando "applicationData"
	- Comando "pullData"
	- Comando "resetTimer"
	- Comando "getUniqueId"
	- Comando "ping"
	- Comando "rand"

## Descripción

RetroProt es un protocolo sobre TCP/IP pensado para juegos o aplicaciones en máquinas retro. El servidor no corre en una máquina retro (aunque podría llegar a implementarse en una, es mejor que sea una máquina moderna y/o en la nube)

El servidor está separado en habitaciones. En cada servidor puede haber un número grande de ellas (2³²⁻¹, aunque normalmente se configurará con un límite más bajo). Cada habitación puede contener de 2 a 255 jugadores. Cualquier jugador puede crear una habitación o unirse a una ya existente. Una habitación es borrada cuando el cliente que la creó sale de ella. Un jugador puede estar como máximo en una habitación en un momento dado. Si crea o entra en otra, se sale de la anterior.

El servidor es agnóstico a la aplicación, significando esto que sólo transfiere datos entre clientes; no almacena ni procesa los datos. Es el cliente el que define la aplicación. El juego que cargas en la máquina retro especifica un id de aplicación de 32 caracteres. Cada cliente puede listar las habitaciones creadas actualmente en el servidor, filtradas por el id de aplicación. El juego puede mostrar un listado de habitaciones a las que unirse, o permitir crear una nueva al jugador.

## Ciclo de transmisión de datos

Una vez el cliente está dentro de una habitación (bien porque la ha creado, o porque ha entrado en ella), el cliente entra en un ciclo contínuo de enviar un mensaje de datos de aplicación al servidor y esperar la respuesta.

Este ciclo debe ser lo más rápido posible para mantener la comunicación en tiempo real.

Si el cliente no envía un mensaje de datos de aplicación "applicationData" (o un mensaje de datos de aplicación vacío "pullData") en un tiempo inferior al timeout especificado para la habitación, el cliente es expulsado del servidor.

El ciclo continúa hasta que el servidor responde que se ha borrado la habitación (o el cliente envía un mensaje "leaveRoom" para salir de la habitación, o un "disconnect", o simplemente cierra la conexión)

## Comandos del cliente

Al conectarse un cliente, puede emitir los comandos descritos en las siguientes secciones.

El comando del cliente se identifica por el primer byte que envía, y a continuación debe enviar más bytes de parámetros según el comando en cuestión.

Tras enviar un comando el cliente debe leer toda la respuesta del servidor (la cual depende del comando) antes de enviar el siguiente comando.

El flujo normal de comandos emitidos por el cliente es:

1. "listRooms"
1. "createRoom" o "enterRoom"
1. Bucle de transmisiones con "applicationData" (y opcionalmente "pullData")
1. "leaveRoom"
1. "disconnect" o volver a 1.

Otros comandos que el cliente puede usar en cualquier momento son: "resetTimer", "getUniqueId", "ping" y "rand".

### Comando "listRooms"

Petición de listar todas las habitaciones actuales del servidor que coinciden con un id de aplicación dado.

Byte de comando: 0x00. Parámetros: 32 bytes de id de aplicación.

El servidor devuelve: 4 bytes (int32_t) con el número de habitaciones actualmente en el servidor que coinciden con el id, más un bloque por cada habitación:

El bloque es:

- 32 bytes de cadena identificadora (única en el servidor) de nombre de habitación, 0-terminada hasta 32 caracteres
- 1 byte con el número de clientes actualmente en la habitación (1 a 255)
- 1 byte con el número de clientes máximo que puede haber en la habitación (2 a 255)
- 1 byte con el número de bytes que envía cada cliente en cada transmisión de datos de aplicación. (1 a 255)
- 1 byte con el timeout de la habitación en cincuentavos de segundo (1 a 255)
- 1 byte con los flags de la habitación

Flags de habitación:

- Bit 0 (LSB): Indica (a 1) que la trama de datos de aplicación devuelta por el servidor en esta habitación incluye timestamp en milisegundos de 4 bytes (int32) (Ver comando "applicationData")
- Bit 1: Indica (a 1) que la habitación permite a un cliente opcionalmente enviar el comando "pullData" en lugar de "applicationData".
- El resto de bits está reservado y debe enviarse a 0 en el comando "createRoom".


### Comando "createRoom"

Petición de crear una habitación nueva.

Byte de comando: 0x01. Parámetros adicionales:

- 32 bytes de cadena identificadora de aplicación, 0-terminada hasta 32 caracteres
- 32 bytes de cadena identificadora (única) de nombre de habitación, 0-terminada hasta 32 caracteres
- 1 byte con el número de clientes máximo que puede haber en esa habitación (2 a 255)
- 1 byte con el número de bytes que envía cada cliente en cada transmisión de datos de aplicación. (1 a 255)
- 1 byte con el timeout de la habitación en cincuentavos de segundo (1 a 255)
- 1 byte con los flags de la habitación (ver comando "listRooms")

El servidor devuelve un byte tras leer todos los parámetros:

- 0x00 Si la habitación se ha creado correctamente, y el cliente se ha metido dentro.
- 0x01 Si el número de habitaciones del servidor ha sido alcanzado y por ello no se ha creado la nueva habitación.
- 0x02 Si el nombre de habitación ya está usado por una habitación existente y por ello no se ha creado la nueva habitación.
- 0x03 Si el el número especificado de clientes máximo que puede haber en esa habitación era inferior a 2, y por ello no se ha creado la nueva habitación.
- 0x04 Si el número especificado de bytes que envía cada cliente en cada transmisión era 0, y por ello no se ha creado la nueva habitación.
- 0x05 Si el timeout especificado era 0, y por ello no se ha creado la nueva habitación.
- 0x06 Si los flags especificados no son soportados en esta versión del protocolo (ver comando "listRooms"), y por ello no se ha creado la nueva habitación.

### Comando "enterRoom"

Petición de entrar en una habitación existente.

Byte de comando: 0x02. Parámetros: 32 bytes de nombre de habitación.

El servidor devuelve un byte:

- 0x00 Si el cliente entró correctamente en la habitación.
- 0x01 Si no entró porque el nombre de habitación no fue encontrado.
- 0x02 Si no entró porque la habitación ya contiene el número de clientes máximo para esa habitación.


### Comando "leaveRoom"

Petición de salir de la habitación en la que el cliente está actualmente.

Byte de comando: 0x03. Sin parámetros adicionales.

El servidor devuelve un byte:

- 0x00 Si el cliente salió correctamente de la habitación.
- 0x01 Si no salió porque no se encontraba en una habitación.


### Comando "disconnect"

Petición de cerrar la conexión.

Byte de comando: 0x04. Sin parámetros adicionales.

El servidor cierra la conexión.

### Comando "applicationData"

Mensaje de datos de aplicación. Cada cliente envía este comando con datos, y el servidor envía a los clientes en la habitación los datos enviados por los mismos.

Byte de comando: 0x05. Parámetros adicionales: El cliente envía N bytes de aplicación (1 a 255). N es especificado al crear la habitación.

Cuando el servidor dispone de todos los bloques de datos de los clientes en la habitación, La respuesta a todos ellos es la siguiente:

- Primero 1 byte indicando el número de clientes actualmente en la habitación que han respondido con datos (M)

Posteriormente vienen (opcionalmente, según los flags configurados para la habitación, ver comando "listRooms"):

- 4 bytes opcionales (int32_t) (si el Bit 0 de los flags es 1) con el tiempo en milisegundos desde que se creó la habitación o se reinició su timer.
- 1 byte opcional (si el Bit 1 de los flags es 1) cuyo valor (P) es el número de clientes que han enviado el comando "pullData" en este ciclo, de 0 a 255.
- A continuación vienen los M bloques de N bytes cada uno con los datos de los clientes (o ningún bloque si M es 0)

Nota: El número de clientes en la habitación es:

- M si el Bit 1 de los flags de habitación es 0.
- M + P si el Bit 1 de los flags de habitación es 1.

Si el número de clientes en la habitación es 0, el cliente puede suponer que la habitación se ha borrado.

### Comando "pullData"

Mensaje vacío de datos de aplicación. Este mensaje se usa para no enviar datos pero aún así obtener datos del resto de clientes en este ciclo.

Byte de comando: 0x06. Sin parámetros adicionales.

La respuesta del servidor es la misma que para el comando "applicationData".

Nota: Para poder usar este comando, la habitación debe tener el flag correspondiente habilitado (ver comando "listRooms") Si no es así el cliente será expulsado del servidor.

### Comando "resetTimer"

Petición de reiniciar el contador de tiempo de la habitación.

Byte de comando: 0x07. Sin parámetros adicionales.

El servidor inicia a 0 el contador de tiempo en milisegundos para la habitación, y responde con un byte:

- 0x00 Contador reiniciado correctamente.
- 0x01 No se ha reiniciado el contador porque el cliente no está en una habitación.
- 0x02 No se ha reiniciado el contador porque la habitación no tiene habilitado el timer en sus flags.

### Comando "getUniqueId"

Petición de obtener un identificador único de usuario dentro de la habitación.

Byte de comando: 0x08. Sin parámetros adicionales.

El servidor responde con un byte de estado:

- 0x00 Se ha obtenido correctamente el identificador.
- 0x01 No se ha podido porque el cliente no está en una habitación.

Si se ha obtenido correctamente el identificador, a continuación el servidor envía un segundo byte con el valor del identificador.

### Comando "ping"

Petición de ping (paquete simple para comprobar el tiempo de respuesta cliente->servidor->cliente)

Byte de comando: 0x09. Sin parámetros adicionales.

El servidor responde con un byte a 0.

### Comando "rand"

Petición de número aleatorio.

Byte de comando: 0x0A. Sin parámetros adicionales.

El servidor responde con un byte con valor aleatorio.
