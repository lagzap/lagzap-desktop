export enum ProfileFlag {
    PUBLIC = 1,         // 1 << 0
    TCP = 2,            // 1 << 1
    UDP = 4,            // 1 << 2

    GAME = 8,           // 1 << 3
    APP = 16,           // 1 << 4

    LAUNCHER = 32,      // 1 << 5
    COMMUNICATION = 64, // 1 << 6
    STREAMING = 128,    // 1 << 7

    DESKTOP = 256,      // 1 << 8
    MOBILE = 512,       // 1 << 9
    CONSOLE = 1024,     // 1 << 10
    ANDROID = 2048,     // 1 << 11
    IOS = 4096,         // 1 << 12
    WINDOWS = 8192,     // 1 << 13

    DEFAULT_SELECTED = 16384,        // 1 << 14
    ALLOW_REGION_SELECTION = 32768,  // 1 << 15
    RESTRICT_PROFILABLES = 65536,    // 1 << 16
}
