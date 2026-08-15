/** Shim do lab: @nestjs/common trava o tsx nesta máquina; as exceções são só
 * portadoras de mensagem — a lógica testada não depende do framework. */
export class BadRequestException extends Error {}
export class NotFoundException extends Error {}
export class InternalServerErrorException extends Error {}
export class ForbiddenException extends Error {}
export class UnauthorizedException extends Error {}
export class ConflictException extends Error {}
export class ServiceUnavailableException extends Error {}
export class UnprocessableEntityException extends Error {}
