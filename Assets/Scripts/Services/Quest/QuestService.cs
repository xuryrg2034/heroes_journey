using System;
using System.Collections.Generic;
using System.Linq;
using Core.Quest;
using UnityEngine;

namespace Services.Quest
{
    public class QuestService : MonoBehaviour
    {
        [SerializeField] private List<QuestItem> questsList;
        private bool _questsCompleted;
        
        public static QuestService Instance;

        private void Awake() {
            if (Instance == null) {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            } else {
                Destroy(gameObject);
            }
        }

        public void Init()
        {
            foreach (var questItem in questsList)
            {
                questItem.Init();
            }
        }

        public List<QuestItem> GetQuests()
        {
            return questsList;
        }

        public bool CheckIsCompletedActiveQuest()
        {
            return questsList.All(item => item.IsCompleted);
        }
    }
}