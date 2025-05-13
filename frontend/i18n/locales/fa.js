export default {
    app_name: 'LagZap',
    loading: 'درحال بازگذاری',
    validation: {
        required: 'این فیلد نمیتواند خالی باشد',
        email: 'ایمیل نامعتبر میباشد',
        min: 'این فیلد حداقل باید {0} کاراکتر باشد',
        max: 'این فیلد حداکثر باید {0} کاراکتر باشد',
        passwordNotMatch: 'رمزعبور و تایید آن با یکدیگر مطابقت ندارد'
    },
    auth: {
        fields: {
            entry: 'شماره همراه / ایمیل',
            name: 'نام',
            phone: 'شماره همراه',
            email: 'ایمیل',
            password: 'رمزعبور',
            passwordConfirm: 'تایید رمزعبور',
        },

        description: 'برای ادامه ایمیل یا شماره همراه خود را وارد نمایید.',
        continueButton: 'ادامه',
        backButton: 'برگشت',

        login: {
            title: 'ورود به سیستم',
            loginButton: 'ورود به سیستم',
            otpLogin: 'دریافت رمز یکبارمصرف',
            descriptionOtpEmail: 'Enter the code sent to your email to continue:',
            descriptionOtpPhone: 'Enter the code sent to your phone to continue:',
        },

        registerDialog: {
            title: 'ثبت نام کنید!',
            description: 'بنظر میرسد شما هنوز ثبت نام نکرده اید، آیا مایل به ثبت نام هستید؟',
            createAccountButton: 'ساخت حساب کاربری',
        },
        register: {
            title: 'ساخت حساب کاربری',
            descriptionEmail: 'کد  ارسال شده به ایمیل خود را وارد نمایید و سپس رمزعبوری را برای حساب خود انتخاب نمایید تا دفعات بعد نیازی به دریافت کد تایید نداشته باشید.',
            descriptionPhone: 'کد پیامک شده را وارد نمایید و سپس رمزعبوری را برای حساب خود انتخاب نمایید تا دفعات بعد نیازی به دریافت کد تایید نداشته باشید.',
            codeNotReceived: 'کد را دریافت نکرده اید؟',
            resendCode: 'ارسال مجدد',
            registerButton: 'ثبت نام',
        }
    },
    close: 'بستن',
}