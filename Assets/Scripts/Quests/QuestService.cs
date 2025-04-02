using System;
using System.Collections.Generic;
using System.Linq;
using Services.EventBus;
using UnityEngine;

namespace Quests
{
    public class QuestService : MonoBehaviour
    {
        [SerializeReference, SubclassSelector]
        List<BaseQuestItem> questsList;
        bool _questsCompleted;

        public void Init()
        {
            foreach (var questItem in questsList)
            {
                questItem.Init();
                questItem.OnComplete.AddListener(CheckIsCompletedActiveQuest);
            }
        }

        public List<BaseQuestItem> GetQuests()
        {
            return questsList;
        }

        void CheckIsCompletedActiveQuest()
        {
            var isAllQuestsCompleted = questsList.All(item => item.IsCompleted);

            if (isAllQuestsCompleted)
            {
                EventBusService.Trigger(Actions.AllQuestCompleted);
            }
        }
    }
}