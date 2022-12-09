if [[ -z $ak  ||  -z $sk  ||  -z $endpoint || -z $bucket || -z $BUILD ]];then
  echo "ak sk endpoint or bucket not exists"
  exit
fi

UNAME_M=$(uname -m)
UNAME_S=$(uname -s)

if [ "${UNAME_M}" == 'x86_64' ]; then
  DESTCPU=x64
  elif [ "${UNAME_M}" == 'amd64' ]; then
  DESTCPU=x64
  elif [ "${UNAME_M}" == 'aarch64' ]; then
  DESTCPU=arm64
  elif [ "${UNAME_M}" == 'arm64' ]; then
  DESTCPU=arm64
else
  echo "DESTCPU not regonized."
  exit 1
fi

ARCH=$(uname -m)

if [[ "${UNAME_S}" == "Linux" ]];then
  OS=linux
  elif [[ "${UNAME_S}" == "Darwin" ]];then
  OS=darwin
fi

function install_ossutil(){
  #linux64
  UNAME_A=$(uname -a)
  if [[ $UNAME_A =~ "Linux" && $UNAME_A =~ "x86_64" ]];then
    wget https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64 -O ossutil
    #linux32
    elif [[ $UNAME_A =~ "Linux" ]];then
    wget https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil32 -O ossutil
    #mac
    elif [[ $UNAME_A =~ "Darwin" ]];then
    wget https://gosspublic.alicdn.com/ossutil/1.7.14/ossutilmac64 -O ossutil
  fi
  
  if [ -f "./ossutil" ]; then
    chmod 755 ossutil
    echo "download ossutil package finished."
  else
    echo "download ossutil package failed! exit 1."
    exit 1
  fi
}

FILE_NAME=noslate-${OS}-${ARCH}-${BUILD}.tar.gz
OSS_PATH=${bucket}/noslate-build-${OS}-${DESTCPU}/${BUILD}
DOWNLOAD_URL=oss://${OSS_PATH}/${FILE_NAME}

echo $DOWNLOAD_URL

# install ossutil
install_ossutil

# config ossutil
./ossutil config -e ${endpoint} -i ${ak} -k ${sk}

# state
STAT=$(./ossutil stat ${DOWNLOAD_URL})

# download aworker
./ossutil cp ${DOWNLOAD_URL} ${FILE_NAME} -f

# check hash
OSS_FILE_HASH=$(echo $STAT | grep -Eo "X-Oss-Hash-Crc64ecma : [0-9]+" | awk -F' : ' '{print $2}')

LOCAL_FILE_HASH=$(./ossutil hash ${FILE_NAME} | cut -d ":" -f 2 | sed s/[[:space:]]//g)

if [ $OSS_FILE_HASH == $LOCAL_FILE_HASH ]; then
  echo "Check hash success."
else
  echo "Check hash failed."
  exit 1
fi

# 解压缩
mkdir out
tar -zxf $FILE_NAME -C ./out

rm -f ${FILE_NAME}
rm -f ossutil