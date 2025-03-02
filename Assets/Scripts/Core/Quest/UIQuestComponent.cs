using System;
using TMPro;
using UnityEngine;

namespace Core.Quest
{
    public class UIQuestComponent : MonoBehaviour
    {
        [SerializeField] private TMP_Text description;
        [SerializeField] private TMP_Text progress;

        private BaseQuestItem _baseQuest;

        public void Init(BaseQuestItem baseQuest)
        {
            _baseQuest = baseQuest;
            _baseQuest.OnUpdate.AddListener(_updateStatus);
            
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
            SetDescription(_baseQuest.Title);
            SetProgress(_baseQuest.GetProgress());
        }
    }
}