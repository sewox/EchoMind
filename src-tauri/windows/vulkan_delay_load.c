/*
 * Lets EchoMind start on Windows machines without a Vulkan driver.
 *
 * ggml's Vulkan backend imports one function from vulkan-1.dll,
 * vkGetInstanceProcAddr. The DLL comes with the graphics driver, so it is
 * missing on virtual machines and on PCs running Microsoft's basic display
 * driver. A normal import would stop the app from starting there, so the DLL
 * is delay-loaded (build.rs) and, when it cannot be loaded, this hook hands
 * ggml a stand-in that reports Vulkan 1.0. ggml needs 1.2, leaves its Vulkan
 * backend out, and Whisper and the local model run on the CPU.
 */
#include <windows.h>
#include <delayimp.h>
#include <string.h>

typedef void(__stdcall *vk_void_function)(void);

static int __stdcall no_vulkan_instance_version(unsigned int *version) {
    *version = 1u << 22; /* VK_API_VERSION_1_0 */
    return 0;            /* VK_SUCCESS */
}

static vk_void_function __stdcall no_vulkan_get_instance_proc_addr(void *instance,
                                                                   const char *name) {
    if (instance == NULL && name != NULL && strcmp(name, "vkEnumerateInstanceVersion") == 0) {
        return (vk_void_function)no_vulkan_instance_version;
    }
    return NULL;
}

static FARPROC WINAPI echomind_delay_load_failure(unsigned notify, PDelayLoadInfo info) {
    if (info == NULL || info->szDll == NULL || _stricmp(info->szDll, "vulkan-1.dll") != 0) {
        return NULL;
    }
    if (notify == dliFailLoadLib) {
        /* Any loaded module will do: looking the function up in it fails,
           which brings the helper back here with dliFailGetProc. */
        return (FARPROC)GetModuleHandleW(NULL);
    }
    if (notify == dliFailGetProc && info->dlp.fImportByName &&
        strcmp(info->dlp.szProcName, "vkGetInstanceProcAddr") == 0) {
        return (FARPROC)no_vulkan_get_instance_proc_addr;
    }
    return NULL;
}

const PfnDliHook __pfnDliFailureHook2 = echomind_delay_load_failure;
