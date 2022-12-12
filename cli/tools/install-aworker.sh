if [[ -z $ak  ||  -z $sk || -z $BUILD ]];then
  echo "ak sk not exists"
  exit
fi

endpoint=oss-cn-zhangjiakou.aliyuncs.com
bucket=alinode-release-archive-zjk

UNAME_M=$(uname -m)
UNAME_S=$(uname -s)

if [ ${UNAME_M} == 'x86_64' ]; then
  DESTCPU=x64
  elif [ ${UNAME_M} == 'amd64' ]; then
  DESTCPU=x64
  elif [ ${UNAME_M} == 'aarch64' ]; then
  DESTCPU=arm64
  elif [ ${UNAME_M} == 'arm64' ]; then
  DESTCPU=arm64
else
  echo "DESTCPU not regonized."
  exit 1
fi

ARCH=$(uname -m)

if [[ ${UNAME_S} == "Linux" ]];then
  OS=linux
  elif [[ ${UNAME_S} == "Darwin" ]];then
  OS=darwin
fi

function install_ossutil(){
  echo "Downloading ossutil."

  UNAME_A=$(uname -a)
  #linux64
  if [[ $UNAME_A =~ "Linux" && $UNAME_A =~ "x86_64" ]];then
    wget -q https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64 -O ossutil
    #linux32
    elif [[ $UNAME_A =~ "Linux" ]];then
    wget -q https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil32 -O ossutil
    #mac
    elif [[ $UNAME_A =~ "Darwin" ]];then
    wget -q https://gosspublic.alicdn.com/ossutil/1.7.14/ossutilmac64 -O ossutil
  fi

  if [ -f "./ossutil" ]; then
    chmod 755 ossutil
    echo "Download ossutil package finished."
  else
    echo "Download ossutil package failed! exit 1."
    exit 1
  fi
}

if echo $BUILD | grep -qE "^[0-9]+\.[0-9]+\.[0-9]+$"; then
  FILE_NAME=noslate-${OS}-${ARCH}-v${BUILD}.tar.gz
  OSS_PATH=${bucket}/noslate-release/v${BUILD}
  DOWNLOAD_URL=oss://${OSS_PATH}/${FILE_NAME}
else
  FILE_NAME=noslate-${OS}-${ARCH}-${BUILD}.tar.gz
  OSS_PATH=${bucket}/noslate-build-${OS}-${DESTCPU}/${BUILD}
  DOWNLOAD_URL=oss://${OSS_PATH}/${FILE_NAME}
fi


# install ossutil
install_ossutil

# config ossutil
./ossutil config -e ${endpoint} -i ${ak} -k ${sk}

# state
STAT=$(./ossutil stat ${DOWNLOAD_URL})

echo "Downloading aworker."
# download aworker
output=$(./ossutil cp ${DOWNLOAD_URL} ${FILE_NAME} -f)

if echo $output | grep -q "Error"; then
  echo "Download aworker from oss failed."
  echo $output
  exit 1
else
  echo "Download aworker success."
fi

# check hash
OSS_FILE_HASH=$(echo $STAT | grep -Eo "X-Oss-Hash-Crc64ecma : [0-9]+" | awk -F' : ' '{print $2}')

LOCAL_FILE_HASH=$(./ossutil hash ${FILE_NAME} | cut -d ":" -f 2 | sed s/[[:space:]]//g)

if [ $OSS_FILE_HASH == $LOCAL_FILE_HASH ]; then
  echo "Check hash success."
else
  echo "Check hash failed."
  rm -f ossutil
  exit 1
fi

# unzip
if [ -d out ]; then
  rm -rf out
fi

mkdir out
tar -zxf $FILE_NAME -C ./out

rm -f ${FILE_NAME}
rm -f ossutil

echo "Install aworker success."