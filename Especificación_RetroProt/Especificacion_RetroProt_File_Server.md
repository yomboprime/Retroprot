
# Protocolo RetroProt File Server

Versión 1.0, 24-3-2021
yomboprime

## Índice

- Descripción
- Ciclo de transmisión de datos
- Restricciones
- Comandos del cliente:
	- Comando "listFiles"
	- Comando "getFileNameAndSize"
	- Comando "downloadFile"
	- Comando "uploadFile"
	- Comando "disconnect"
	- Comando "ping"

## Descripción

RetroProt File Server es un protocolo sobre TCP/IP pensado para descargar ficheros en máquinas retro. El servidor no corre en una máquina retro (aunque podría llegar a implementarse en una, es mejor que sea una máquina moderna y/o en la nube)

## Ciclo de transmisión de datos

Una vez el cliente ha conectado al servidor, puede enviar comandos y recibir su respuesta.

El ciclo continúa hasta que alguna de las dos partes simplemente cierra la conexión.

## Restricciones

- Máxima longitud de un 'path' completo incluyendo separadores, nombre de fichero, extensión y el 0 final: 255
- Máximo número de ficheros y/o directorios dentro de un directorio: 65535
- Máximo tamaño en bytes de un fichero: 2^32 - 1

## Comandos del cliente

Al conectarse un cliente, puede emitir los comandos descritos en las siguientes secciones.

El comando del cliente se identifica por el primer byte que envía, y a continuación debe enviar más bytes de parámetros según el comando en cuestión.

Tras enviar un comando el cliente debe leer toda la respuesta del servidor (la cual depende del comando) antes de enviar el siguiente comando.

### Comando "listFiles"

Petición de listar ficheros de un directorio en el servidor, identificado por un 'path'.

Byte de comando: 0x00.

Parámetros:

- Cadena ASCII terminada en 0 con el 'path' absoluto del directorio a mostrar. El carácter separador de nombres de directorio es '/'.
- Cadena ASCII terminada en 0 que representa un filtro (o cadena de búsqueda). Puede contener varias palabras separadas por espacio (' '). Está limitada a 255 caracteres, como los 'path'. Use la cadena vacía para no filtrar. El servidor filtrará las entradas, devolviendo sólo aquellas que contengan estas palabras en su nombre. Cuando se realiza una búsqueda, ésta se realiza también recursivamente en subdirectorios, no sólo en el directorio especificado.
- 1 byte indicando la ordenación que deben seguir la lista de ficheros y directorios. Los directorios siempre vienen antes que los ficheros.
	- Con valor 0x00, los ficheros tendrán orden alfabético creciente.
	- Con valor 0x01, los ficheros tendrán orden alfabético decreciente.
	- Con valor 0x02, los ficheros tendrán orden por tamaño, de mayor a menor.
	- Con valor 0x03, los ficheros tendrán orden por tamaño, de menor a mayor.
	- Con valor 0x04, los ficheros tendrán orden por fecha de creación decreciente.
	- Con valor 0x05, los ficheros tendrán orden por fecha de creación creciente.
- 2 bytes: Número uint16_t (LSByte primero) con el offset del primer fichero a mostrar. Sirve para que el cliente pueda mostrar páginas de ficheros, especificando un offset según el número de página y el número de ficheros por página en el cliente.
- 2 bytes: Número uint16_t (LSByte primero) con el número máximo de entradas a devolver (Sería el número de ficheros por página en el cliente)
- 1 byte: Número uint8_t con el tamaño máximo del nombre del fichero en cada entrada devuelta (maxBytesFileName), sin tener en cuenta el 'path' del directorio, ni la extensión (3 caracteres) ni el punto separador.

Respuesta del servidor:

- 1 byte con el código de estado:
	- 0x00 Si la operación fue bien
	- 0x01 si el 'path' especificado no existe. En este último caso no hay más bytes de respuesta.
- 2 bytes: uint16_t (LSByte primero) con el número total de entradas en el directorio (una vez aplicada la cadena de búsqueda, si la había).
- 2 bytes: uint16_t (LSByte primero) con el número de entradas devueltas (N)
- A continuación vienen N bloques de ( 9 + maxBytesFileName ) bytes que constituyen las entradas devueltas de los directorios y ficheros. Cada entrada tiene los siguientes bytes:
	- 1 byte indicando si la entrada es un directorio ('>') o un fichero (' ')
	- 'maxBytesFileName' bytes con el nombre del fichero. No está terminado con el byte 0, sino 'padded' con espacios (' ')
	- 1 byte que indica, con el valor '.', que el nombre de fichero se recortó porque era muy largo para caber en 'maxBytesFileName' bytes. Con valor ' ', el byte indica que el nombre de fichero no se recortó.
	- 3 bytes, con la extensión del nombre de fichero, 'padded' con espacios (' ')
	- 4 bytes, uint32_t (LSByte primero) con el tamaño en bytes del fichero. En caso de ser un directorio, el valor es 0.

### Comando "getFileNameAndSize"

Petición de obtener el nombre completo sin recortar de una entrada de fichero concreta, así como su tipo y longitud en bytes.

Byte de comando: 0x01

Parámetros:

- Cadena ASCII terminada en 0 con el 'path' absoluto del directorio cuya entrada se quiere acceder. El carácter separador de nombres de directorio es '/'.
- Cadena ASCII terminada en 0 que representa un filtro (o cadena de búsqueda). Ver comando "listFiles".
- 1 byte indicando la ordenación que deben seguir la lista de ficheros y directorios. Ver comando "listFiles".
- 2 bytes: Número uint16_t (LSByte primero) con el número entrada a acceder dentro del directorio.

Respuesta del servidor:

- 1 byte con el código de estado:
	- 0x00 Si la operación fue bien
	- 0x01 si el 'path' especificado no existe. En este caso no hay más bytes de respuesta.
	- 0x02 si el índice de entrada especicado cae fuera del número de entradas totales. En este caso no hay más bytes de respuesta.
- 1 byte indicando si la entrada es un directorio ('>') o un fichero (' ')
- Cadena ASCII terminada en 0 con el nombre de fichero completo (sin el 'path') de la entrada. Está limitado a 255 caracteres (incluyendo el 0 final), como todos los 'path' en este protocolo.
- 4 bytes, uint32_t (LSByte primero) con el tamaño en bytes del fichero. En caso de ser un directorio, el valor es 0.

### Comando "downloadFile"

Petición de descargar un fichero.

Byte de comando: 0x02

Parámetros:

- Cadena ASCII terminada en 0 con el 'path' absoluto del directorio cuya entrada se quiere descargar. El carácter separador de nombres de directorio es '/'.
- Cadena ASCII terminada en 0 que representa un filtro (o cadena de búsqueda). Ver comando "listFiles".
- 1 byte indicando la ordenación que deben seguir la lista de ficheros y directorios. Ver comando "listFiles".
- 2 bytes: Número uint16_t (LSByte primero) con el número entrada a descargar.

Respuesta del servidor:

- 1 byte con el código de estado:
	- 0x00 Si la operación fue bien
	- 0x01 si el 'path' especificado no existe. En este caso no hay más bytes de respuesta.
	- 0x02 si el índice de entrada especicado cae fuera del número de entradas totales. En este caso no hay más bytes de respuesta.
	- 0x03 si la entrada es un directorio y por ello no se puede descargar. En este caso no hay más bytes de respuesta.
- 4 bytes, uint32_t (LSByte primero) con el tamaño en bytes del fichero (N)
- A continuación vienen N bytes con el contenido del fichero.

### Comando "uploadFile"

Petición de subir un fichero.

Byte de comando: 0x03

Parámetros:

- Cadena ASCII terminada en 0 con el 'path' absoluto del directorio más el nombre de fichero que se quiere subir. El carácter separador de nombres de directorio es '/'.
- 4 bytes, uint32_t (LSByte primero) con el tamaño en bytes del fichero.

Respuesta del servidor:

- 1 byte con el código de estado:
	- 0x00 Si la operación fue bien
	- 0x01 si el nombre de fichero especificado ya existe. En este caso no hay más bytes de respuesta.
	- 0x02 si el tamaño en bytes del fichero era 0.
	- 0x03 si el tamaño en bytes del fichero supera el límite prefijado en el servidor.
	- 0x04 si hubo un error en el servidor al abrir el fichero para escritura.

A continuación de la respuesta correcta del servidor, el cliente debe enviar los bytes especificados en el parámetro "longitud del fichero".

Tras recibir el contenido del fichero, el servidor responde nuevamente con un byte 0x00 y con ello termina la ejecución del comando.

### Comando "disconnect"

Petición de cerrar la conexión.

Byte de comando: 0x04. Sin parámetros adicionales.

El servidor cierra la conexión.

### Comando "ping"

Petición de ping (paquete simple para comprobar el tiempo de respuesta cliente->servidor->cliente)

Byte de comando: 0x05. Sin parámetros adicionales.

El servidor responde con un byte a 0.
