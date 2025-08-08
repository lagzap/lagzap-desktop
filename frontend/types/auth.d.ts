type AuthBy = "phone" | "email" | undefined;

interface EntryForm {
  entry: string;
}

interface RegisterForm {
  otp: number;
  password?: string;
  passwordConfirm?: string;
}
interface RegisterResponse {
  message: string;
}

interface OtpResponse {
  message: string;
  otpID: number;
}

interface LoginForm {
  password: string;
}
interface LoginOtpForm {
  otp: string;
}

interface OtpForm {
  phone: number;
  otp: number;
}

interface CheckResponse {
  exists: boolean;
  type: "email" | "phone";
}
