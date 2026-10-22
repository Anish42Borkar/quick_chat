import { IsString, MaxLength, MinLength } from "class-validator";
export class RequestOtpDto {
  @IsString() @MinLength(7) @MaxLength(25) mobileNumber!: string;
}
