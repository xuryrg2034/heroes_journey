using System;
using TMPro;
using UnityEngine;

namespace Core.Quest
{
    public class UIQuestComponent : MonoBehaviour
    {
        [SerializeField] private TMP_Text description;
        [SerializeField] private TMP_Text progress;

        private QuestItem _quest;

        private void OnDisable()
        {
            _quest.OnUpdate -= _updateStatus;
        }

        public void Init(QuestItem quest)
        {
            _quest = quest;
            _quest.OnUpdate += _updateStatus;
            
            _updateStatus();
        }
        
        public void SetDescription(string value)
        {
            description.text = value;
        }
        
        public void SetProgress(string value)
        {
            progress.text = value;
        }

        private void _updateStatus()
        {
            SetDescription(_quest.Description);
            SetProgress(_quest.GetProgress());
        }
    }
}