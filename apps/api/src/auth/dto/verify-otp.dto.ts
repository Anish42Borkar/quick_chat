import { IsString, Matches, MaxLength, MinLength } from "class-validator";
export class VerifyOtpDto {
  @IsString() @MinLength(7) @MaxLength(25) mobileNumber!: string;
  @IsString() @Matches(/^\d{6}$/) otp!: string;
}
