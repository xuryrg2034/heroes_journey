using System;
using System.Collections.Generic;
using System.Linq;
using Core.Quest;
using UnityEngine;

namespace Services.Quest
{
    public class QuestService : MonoBehaviour
    {
        [SerializeReference, SubclassSelector]
        private List<BaseQuestItem> questsList;
        private bool _questsCompleted;

        public void Init()
        {
            foreach (var questItem in questsList)
            {
                questItem.Init();
            }
        }

        public List<BaseQuestItem> GetQuests()
        {
            return questsList;
        }

        public bool CheckIsCompletedActiveQuest()
        {
            return questsList.All(item => item.IsCompleted);
        }
    }
}