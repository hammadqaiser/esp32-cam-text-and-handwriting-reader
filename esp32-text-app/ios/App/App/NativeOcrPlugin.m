#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NativeOcrPlugin, "NativeOcr",
    CAP_PLUGIN_METHOD(recognizeText, CAPPluginReturnPromise);
)
