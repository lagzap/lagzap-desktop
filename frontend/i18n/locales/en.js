export default {
    app_name: 'LagZap',
    loading: 'Loading',
    validation: {
        required: 'This field cannot be empty',
        email: 'This email is invalid',
        min: 'This field should be minimum {0} characters',
        max: 'This field should be max {0} characters',
        passwordNotMatch: 'The password confirmation does not match'
    },
    auth: {
        fields: {
            entry: 'Phone / Email',
            name: 'Name',
            phone: 'Phone',
            email: 'Email',
            password: 'Password',
            passwordConfirm: 'Password confirmation',
        },
        
        description: 'Enter your email or phone number to continue to.',
        continueButton: 'Continue',
        backButton: 'Back',

        login: {
            title: 'Sign In',
            loginButton: 'Sign In',
            otpLogin: 'Get one-time password',
            descriptionOtpEmail: 'Enter the code sent to your email to continue:',
            descriptionOtpPhone: 'Enter the code sent to your phone to continue:',
        },

        registerDialog: {
            title: 'Let\'s create an account!',
            description: 'Looks like you are not registered on LagZap, are you willing to create an account?',
            createAccountButton: 'Create an Account',
        },
        register: {
            title: 'Create an Account',
            descriptionEmail: 'Enter the code sent to your email and then choose a password for your account so that you do not need to receive a confirmation code next time.',
            descriptionPhone: 'Enter the SMS code and then choose a password for your account so that you don\'t need to receive a confirmation code next time.',
            codeNotReceived: 'Didn\'t receive the code?',
            resendCode: 'Resend',
            registerButton: 'Register',
        }
    },
    close: 'Close',
}