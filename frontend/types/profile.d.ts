interface ProfileBasicForm {
  name: string?;
  phone: number?;
  email: string?;
}
interface ProfilePasswordForm {
  otp: string?;
  password: string?;
  passwordConfirm: string?;
}
interface ProfileResponse {
  message: string;
}