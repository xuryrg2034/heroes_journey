using System;
using System.Collections.Generic;
using System.Linq;
using Core.Quest;
using Services.EventBus;
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
                questItem.OnComplete.AddListener(_checkIsCompletedActiveQuest);
            }
        }

        public List<BaseQuestItem> GetQuests()
        {
            return questsList;
        }

        private void _checkIsCompletedActiveQuest()
        {
            var isAllQuestsCompleted = questsList.All(item => item.IsCompleted);

            if (isAllQuestsCompleted)
            {
                EventBusService.Trigger(Actions.AllQuestCompleted);
            }
        }
    }
}